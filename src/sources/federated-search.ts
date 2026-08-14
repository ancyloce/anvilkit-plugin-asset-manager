/**
 * @file Federated search across asset source providers (PRD 0002 §9.3).
 *
 * Routes a single-source query to one provider, or federates across many with
 * `Promise.allSettled` (one failing remote never blanks the rest). The page
 * cursor is an OPAQUE composite token carrying one sub-cursor per source, so
 * each provider paginates independently. Comparable sorts (name/size/kind) are
 * k-way merged; `recent`/`relevance` fall back to provider-grouped order
 * (incomparable across heterogeneous sources).
 */

import type { AssetFilter, AssetListPage } from "../types/filter.js";
import type { AssetRegistry, UploadResult } from "../types/types.js";
import type { ResolvedAssetDataSource } from "../utils/data-source.js";
import { inferAssetKind } from "../utils/infer-kind.js";
import type { AssetSourceProvider } from "./provider.js";

type CompositeCursor = Record<string, string | undefined>;

interface BufferedSourceCursor {
	readonly cursor?: string;
	readonly items?: readonly UploadResult[];
}

interface BufferedCompositeCursor {
	readonly version: 1;
	readonly sources: Readonly<Record<string, BufferedSourceCursor>>;
	readonly totals?: Readonly<Record<string, number>>;
}

const DEFAULT_FEDERATED_LIMIT = 50;

function toBase64Url(json: string): string {
	const binary = Array.from(new TextEncoder().encode(json), (byte) =>
		String.fromCharCode(byte),
	).join("");
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

function fromBase64Url(token: string): string {
	const padded =
		token.length % 4 === 0 ? token : token + "=".repeat(4 - (token.length % 4));
	const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
	return new TextDecoder().decode(
		Uint8Array.from(binary, (character) => character.charCodeAt(0)),
	);
}

export function encodeCompositeCursor(cursor: CompositeCursor): string {
	return toBase64Url(JSON.stringify(cursor));
}

export function decodeCompositeCursor(
	token: string | undefined,
): CompositeCursor {
	if (token === undefined || token === "") return {};
	try {
		const parsed = JSON.parse(fromBase64Url(token));
		if (isBufferedCompositeCursor(parsed)) {
			return Object.fromEntries(
				Object.entries(parsed.sources).map(([id, source]) => [
					id,
					source.cursor,
				]),
			);
		}
		return typeof parsed === "object" && parsed !== null
			? (parsed as CompositeCursor)
			: {};
	} catch {
		return {};
	}
}

function isBufferedCompositeCursor(
	value: unknown,
): value is BufferedCompositeCursor {
	if (value === null || typeof value !== "object") return false;
	const candidate = value as { version?: unknown; sources?: unknown };
	return (
		candidate.version === 1 &&
		candidate.sources !== null &&
		typeof candidate.sources === "object"
	);
}

function decodeBufferedCursor(token: string | undefined): {
	readonly continuation: boolean;
	readonly sources: Readonly<Record<string, BufferedSourceCursor>>;
	readonly totals: Readonly<Record<string, number>>;
} {
	if (token === undefined || token === "") {
		return { continuation: false, sources: {}, totals: {} };
	}
	try {
		const parsed: unknown = JSON.parse(fromBase64Url(token));
		if (isBufferedCompositeCursor(parsed)) {
			return {
				continuation: true,
				sources: parsed.sources,
				totals: parsed.totals ?? {},
			};
		}
		if (parsed !== null && typeof parsed === "object") {
			const sources = Object.fromEntries(
				Object.entries(parsed).flatMap(([id, cursor]) =>
					typeof cursor === "string" ? [[id, { cursor }]] : [],
				),
			);
			return {
				continuation: Object.keys(sources).length > 0,
				sources,
				totals: {},
			};
		}
	} catch {
		// A malformed cursor retains the historic behavior: restart at page one.
	}
	return { continuation: false, sources: {}, totals: {} };
}

function encodeBufferedCursor(
	sources: Readonly<Record<string, BufferedSourceCursor>>,
	totals: Readonly<Record<string, number>>,
): string {
	return toBase64Url(
		JSON.stringify({
			version: 1,
			sources,
			totals,
		} satisfies BufferedCompositeCursor),
	);
}

/** A provider is eligible only if it can satisfy every required axis of the filter. */
export function providerCanSatisfy(
	provider: AssetSourceProvider,
	filter: AssetFilter,
): boolean {
	if (filter.folderId !== undefined && provider.capabilities.folders !== true) {
		return false;
	}
	return true;
}

/** Adapt the resolved (local) data source into an `AssetSourceProvider`. */
export function createLocalProvider(
	source: ResolvedAssetDataSource,
	registry: AssetRegistry,
	label = "assetManager.source.library",
): AssetSourceProvider {
	return {
		id: "local",
		label,
		capabilities: {
			searchable: true,
			themed: false,
			mutable: true,
			requiresAttribution: false,
			folders: true,
		},
		listThemes: () => [],
		// Always scope to the per-source sub-cursor — never the opaque COMPOSITE
		// `filter.cursor`, which is meaningless to a single source and would
		// corrupt local pagination if passed through.
		search: (filter, page, signal) =>
			source.list({ ...filter, cursor: page }, signal),
		// Local assets are already catalogued — "picking" returns the stored result.
		pickResult: async (asset) =>
			registry.get(asset.id) ?? { id: asset.id, url: asset.url },
	};
}

function sortKey(
	entry: UploadResult,
	field: "name" | "size" | "kind",
): string | number {
	switch (field) {
		case "name":
			return (entry.name ?? "").toLowerCase();
		case "size":
			return entry.meta?.size ?? 0;
		case "kind":
			return inferAssetKind(entry);
	}
}

function compareEntries(
	a: UploadResult,
	b: UploadResult,
	field: "name" | "size" | "kind",
): number {
	const ka = sortKey(a, field);
	const kb = sortKey(b, field);
	if (typeof ka === "number" && typeof kb === "number") return ka - kb;
	return String(ka).localeCompare(String(kb));
}

type SourceErrorMap = Record<string, { message: string; code?: string }>;

interface WorkingSourceState {
	readonly provider: AssetSourceProvider;
	readonly fetchedCursors: Set<string>;
	items: UploadResult[];
	cursor?: string;
	needsFetch: boolean;
}

/** Normalize a rejected provider search into a `{ message, code? }` pair. */
function describeReason(reason: unknown): { message: string; code?: string } {
	if (reason instanceof Error) {
		const code = (reason as { code?: unknown }).code;
		return {
			message: reason.message || reason.name,
			...(typeof code === "string" ? { code } : {}),
		};
	}
	// Structural rejection (e.g. a plain `{ message, code }` object).
	if (reason !== null && typeof reason === "object") {
		const message = (reason as { message?: unknown }).message;
		const code = (reason as { code?: unknown }).code;
		if (typeof message === "string") {
			return {
				message,
				...(typeof code === "string" ? { code } : {}),
			};
		}
	}
	return { message: safeString(reason) };
}

/** `String(value)` that never throws (a hostile `toString` must not abort the page). */
function safeString(value: unknown): string {
	try {
		return String(value);
	} catch {
		return "Unknown error";
	}
}

export interface FederatedSearchInput {
	readonly providers: readonly AssetSourceProvider[];
	readonly filter: AssetFilter;
	readonly signal?: AbortSignal;
}

/**
 * Run a filter across providers. `filter.sources` naming exactly one provider
 * ROUTES to it (zero other calls); otherwise eligible providers FEDERATE.
 */
export async function federatedSearch(
	input: FederatedSearchInput,
): Promise<AssetListPage> {
	const { providers, filter, signal } = input;
	const decoded = decodeBufferedCursor(filter.cursor);
	const eligible = providers.filter((p) => providerCanSatisfy(p, filter));
	const requestedSources = new Set(filter.sources ?? []);
	const sourceScoped =
		requestedSources.size > 0
			? eligible.filter((p) => requestedSources.has(p.id))
			: eligible;
	const targets = decoded.continuation
		? sourceScoped.filter(
				(provider) => decoded.sources[provider.id] !== undefined,
			)
		: sourceScoped;

	if (targets.length === 0) {
		return { items: Object.freeze([]), total: 0, nextCursor: undefined };
	}

	const limit =
		filter.limit !== undefined &&
		Number.isFinite(filter.limit) &&
		filter.limit > 0
			? Math.floor(filter.limit)
			: DEFAULT_FEDERATED_LIMIT;
	const field = filter.sort?.field ?? "recent";
	const comparable = field === "name" || field === "size" || field === "kind";
	const direction =
		filter.sort?.direction ?? (field === "name" ? "asc" : "desc");
	const sign = direction === "asc" ? 1 : -1;
	const totals: Record<string, number> = { ...decoded.totals };
	const states: WorkingSourceState[] = targets.map((provider) => {
		const buffered = decoded.sources[provider.id];
		const items = Array.isArray(buffered?.items) ? [...buffered.items] : [];
		return {
			provider,
			fetchedCursors: new Set<string>(),
			items,
			cursor: buffered?.cursor,
			needsFetch:
				!decoded.continuation ||
				(items.length === 0 && buffered?.cursor !== undefined),
		};
	});
	const fetchTargets = states.filter((state) => state.needsFetch);
	const providerFilter: AssetFilter = {
		...filter,
		cursor: undefined,
		limit,
	};
	// Resilient: a failed provider is dropped from THIS page (successful
	// providers still return), but its incoming sub-cursor remains in its state
	// so the next page retries it from the same position. The error is surfaced via
	// `sourceErrors` so the sidebar can show a non-blocking degraded hint
	// instead of silently dropping the failure.
	const sourceErrors: SourceErrorMap = {};
	const failed = new Set<string>();
	const visibleSourceCursors = new Set(
		decoded.continuation ? Object.keys(decoded.sources) : [],
	);
	const fetchState = async (state: WorkingSourceState): Promise<boolean> => {
		const incomingCursor = state.cursor;
		const cursorKey =
			incomingCursor === undefined ? "initial" : `next:${incomingCursor}`;
		if (state.fetchedCursors.has(cursorKey)) return false;
		state.fetchedCursors.add(cursorKey);
		state.needsFetch = false;
		try {
			const page = await state.provider.search(
				providerFilter,
				incomingCursor,
				signal,
			);
			const pageItems = [...page.items];
			if (comparable) {
				pageItems.sort(
					(a, b) =>
						compareEntries(a, b, field as "name" | "size" | "kind") * sign,
				);
			}
			state.items.push(...pageItems);
			state.cursor = page.nextCursor;
			totals[state.provider.id] = page.total;
			visibleSourceCursors.add(state.provider.id);
			return true;
		} catch (reason) {
			failed.add(state.provider.id);
			sourceErrors[state.provider.id] = describeReason(reason);
			return false;
		}
	};
	await Promise.all(fetchTargets.map(fetchState));

	const items: UploadResult[] = [];
	if (comparable) {
		while (items.length < limit) {
			const missingHeads = states.filter(
				(state) =>
					state.items.length === 0 &&
					state.cursor !== undefined &&
					!failed.has(state.provider.id),
			);
			if (missingHeads.length > 0) {
				await Promise.all(missingHeads.map(fetchState));
			}
			// If a provider did not advance its cursor, its next sort key is unknown.
			// Stop rather than emit another provider out of global order.
			if (
				states.some(
					(state) =>
						state.items.length === 0 &&
						state.cursor !== undefined &&
						!failed.has(state.provider.id),
				)
			) {
				break;
			}
			const candidates = states.filter((state) => state.items.length > 0);
			if (candidates.length === 0) break;
			let winner = candidates[0];
			if (winner === undefined) break;
			for (const candidate of candidates.slice(1)) {
				const winnerItem = winner.items[0];
				const candidateItem = candidate.items[0];
				if (
					winnerItem !== undefined &&
					candidateItem !== undefined &&
					compareEntries(
						candidateItem,
						winnerItem,
						field as "name" | "size" | "kind",
					) *
						sign <
						0
				) {
					winner = candidate;
				}
			}
			const next = winner.items.shift();
			if (next !== undefined) items.push(next);
		}
	} else {
		// `recent` and `relevance` have no cross-provider comparable key. Preserve
		// provider-grouped order across calls by fully draining each source before
		// moving to the next one.
		for (const state of states) {
			while (items.length < limit) {
				const next = state.items.shift();
				if (next !== undefined) {
					items.push(next);
					continue;
				}
				break;
			}
			if (items.length === limit) break;
			if (state.cursor !== undefined && !failed.has(state.provider.id)) {
				break;
			}
		}
	}

	const nextSources: Record<string, BufferedSourceCursor> = {};
	for (const state of states) {
		if (state.items.length > 0 || state.cursor !== undefined) {
			nextSources[state.provider.id] = {
				...(state.cursor !== undefined ? { cursor: state.cursor } : {}),
				...(state.items.length > 0 ? { items: state.items } : {}),
			};
		}
	}
	const sourceCursors = Object.fromEntries(
		states.flatMap((state) =>
			visibleSourceCursors.has(state.provider.id)
				? [[state.provider.id, state.cursor]]
				: [],
		),
	);
	const total = sourceScoped.reduce(
		(sum, provider) => sum + (totals[provider.id] ?? 0),
		0,
	);

	return {
		items: Object.freeze(items),
		total,
		nextCursor:
			Object.keys(nextSources).length > 0
				? encodeBufferedCursor(nextSources, totals)
				: undefined,
		sourceCursors,
		...(Object.keys(sourceErrors).length > 0
			? { sourceErrors: Object.freeze(sourceErrors) }
			: {}),
	};
}
