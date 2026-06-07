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
		search: (filter, page, signal) =>
			source.list(
				page !== undefined ? { ...filter, cursor: page } : filter,
				signal,
			),
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

function mergePages(
	pages: readonly { provider: AssetSourceProvider; page: AssetListPage }[],
	filter: AssetFilter,
	carryForward: CompositeCursor = {},
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
	};
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
	const eligible = providers.filter((p) => providerCanSatisfy(p, filter));
	const targets =
		filter.sources && filter.sources.length > 0
			? eligible.filter((p) => filter.sources?.includes(p.id))
			: eligible;

	if (targets.length === 0) {
		return { items: Object.freeze([]), total: 0, nextCursor: undefined };
	}

	const cursors = decodeCompositeCursor(filter.cursor);
	const settled = await Promise.allSettled(
		targets.map((p) => p.search(filter, cursors[p.id], signal)),
	);

	// Resilient: a failed provider is dropped from THIS page (successful
	// providers still return), but its incoming sub-cursor is carried forward
	// (C2) so the next page retries it from the same position instead of
	// silently resetting it to page 1 — which would skip the failed page and
	// repeat earlier ones. (Surfacing the per-source error in the UI is a
	// separate, still-open enhancement.)
	const ok: { provider: AssetSourceProvider; page: AssetListPage }[] = [];
	const carryForward: CompositeCursor = {};
	settled.forEach((result, index) => {
		const provider = targets[index];
		if (provider === undefined) return;
		if (result.status === "fulfilled") {
			ok.push({ provider, page: result.value });
		} else {
			const incoming = cursors[provider.id];
			if (incoming !== undefined) carryForward[provider.id] = incoming;
		}
	});

	return mergePages(ok, filter, carryForward);
}
