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

function toBase64Url(json: string): string {
	return btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(token: string): string {
	const padded =
		token.length % 4 === 0 ? token : token + "=".repeat(4 - (token.length % 4));
	return atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
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
		return typeof parsed === "object" && parsed !== null
			? (parsed as CompositeCursor)
			: {};
	} catch {
		return {};
	}
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

function mergePages(
	pages: readonly { provider: AssetSourceProvider; page: AssetListPage }[],
	filter: AssetFilter,
	carryForward: CompositeCursor = {},
	sourceErrors: SourceErrorMap = {},
): AssetListPage {
	const field = filter.sort?.field ?? "recent";
	const comparable = field === "name" || field === "size" || field === "kind";

	// Each provider already returned a page (limited by its own sub-cursor).
	const items: UploadResult[] = pages.flatMap((p) => [...p.page.items]);
	if (comparable) {
		const dir = filter.sort?.direction ?? (field === "name" ? "asc" : "desc");
		const sign = dir === "asc" ? 1 : -1;
		items.sort((a, b) => compareEntries(a, b, field) * sign);
	}
	// Otherwise: provider-grouped order (caller passes local first).

	const total = pages.reduce((n, p) => n + p.page.total, 0);
	// Seed with the carry-forward sub-cursors of any provider that FAILED this
	// page (C2) so it resumes from the same position; successful providers then
	// overwrite their own slot with the real next cursor below.
	const sourceCursors: Record<string, string | undefined> = { ...carryForward };
	const next: CompositeCursor = { ...carryForward };
	let hasNext = Object.keys(carryForward).length > 0;
	for (const { provider, page } of pages) {
		sourceCursors[provider.id] = page.nextCursor;
		if (page.nextCursor !== undefined) {
			next[provider.id] = page.nextCursor;
			hasNext = true;
		}
	}

	return {
		items: Object.freeze(items),
		total,
		nextCursor: hasNext ? encodeCompositeCursor(next) : undefined,
		sourceCursors,
		...(Object.keys(sourceErrors).length > 0
			? { sourceErrors: Object.freeze(sourceErrors) }
			: {}),
	};
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
	const cursors = decodeCompositeCursor(filter.cursor);
	// A continuation page carries per-source sub-cursors. A provider absent from
	// the composite cursor was exhausted on an earlier page (or never started);
	// re-querying it with no sub-cursor would restart its pagination and
	// duplicate already-seen results, so on a continuation page only providers
	// that still have a sub-cursor are queried.
	const isContinuation =
		filter.cursor !== undefined && Object.keys(cursors).length > 0;
	const eligible = providers.filter((p) => providerCanSatisfy(p, filter));
	const requestedSources = new Set(filter.sources ?? []);
	const sourceScoped =
		requestedSources.size > 0
			? eligible.filter((p) => requestedSources.has(p.id))
			: eligible;
	const targets = isContinuation
		? sourceScoped.filter((p) => cursors[p.id] !== undefined)
		: sourceScoped;

	if (targets.length === 0) {
		return { items: Object.freeze([]), total: 0, nextCursor: undefined };
	}

	const settled = await Promise.allSettled(
		targets.map((p) => p.search(filter, cursors[p.id], signal)),
	);

	// Resilient: a failed provider is dropped from THIS page (successful
	// providers still return), but its incoming sub-cursor is carried forward
	// (C2) so the next page retries it from the same position instead of
	// silently resetting it to page 1 — which would skip the failed page and
	// repeat earlier ones. The error is ALSO surfaced per-source via
	// `sourceErrors` so the sidebar can show a non-blocking degraded hint
	// instead of silently dropping the failure.
	const ok: { provider: AssetSourceProvider; page: AssetListPage }[] = [];
	const carryForward: CompositeCursor = {};
	const sourceErrors: SourceErrorMap = {};
	settled.forEach((result, index) => {
		const provider = targets[index];
		if (provider === undefined) return;
		if (result.status === "fulfilled") {
			ok.push({ provider, page: result.value });
		} else {
			const incoming = cursors[provider.id];
			if (incoming !== undefined) carryForward[provider.id] = incoming;
			sourceErrors[provider.id] = describeReason(result.reason);
		}
	});

	return mergePages(ok, filter, carryForward, sourceErrors);
}
