import type {
	AssetKind,
	AssetRegistry,
	AssetRegistryListener,
	AssetSearchOptions,
	AssetSearchPage,
	UploadResult,
} from "../types/types.js";
import { inferAssetKind } from "./infer-kind.js";

const DEFAULT_SEARCH_LIMIT = 50;

export function createAssetRegistry(): AssetRegistry {
	const assetsById = new Map<string, UploadResult>();
	const listeners = new Set<AssetRegistryListener>();

	const notify = (): void => {
		for (const listener of listeners) {
			listener();
		}
	};

	return {
		register(asset) {
			const stored = freezeUploadResult(asset);
			assetsById.set(stored.id, stored);
			notify();
			return stored;
		},
		get(id) {
			return assetsById.get(id);
		},
		list() {
			return Object.freeze([...assetsById.values()]);
		},
		delete(id) {
			const removed = assetsById.delete(id);
			if (removed) {
				notify();
			}
			return removed;
		},
		rename(id, name) {
			const current = assetsById.get(id);
			if (current === undefined) {
				return undefined;
			}
			const trimmed = name.trim();
			const next = freezeUploadResult({
				...current,
				...(trimmed === "" ? {} : { name: trimmed }),
			});
			assetsById.set(id, next);
			notify();
			return next;
		},
		replace(id, next) {
			if (!assetsById.has(id)) {
				return undefined;
			}
			const merged = freezeUploadResult({ ...next, id });
			assetsById.set(id, merged);
			notify();
			return merged;
		},
		setTags(id, tags) {
			const current = assetsById.get(id);
			if (current === undefined) {
				return undefined;
			}
			const normalized = normalizeTags(tags);
			const { tags: _existing, ...rest } = current;
			const next = freezeUploadResult(
				normalized.length > 0 ? { ...rest, tags: normalized } : rest,
			);
			assetsById.set(id, next);
			notify();
			return next;
		},
		search(options) {
			return runSearch(assetsById, options ?? {});
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}

function freezeUploadResult(asset: UploadResult): UploadResult {
	const nextAsset: UploadResult = {
		id: asset.id,
		url: asset.url,
		...(asset.name !== undefined ? { name: asset.name } : {}),
		...(asset.meta
			? {
					meta: Object.freeze({
						...(asset.meta.size !== undefined ? { size: asset.meta.size } : {}),
						...(asset.meta.mimeType !== undefined
							? { mimeType: asset.meta.mimeType }
							: {}),
						...(asset.meta.width !== undefined
							? { width: asset.meta.width }
							: {}),
						...(asset.meta.height !== undefined
							? { height: asset.meta.height }
							: {}),
						...(asset.meta.attribution !== undefined
							? {
									attribution: Object.freeze({
										...asset.meta.attribution,
									}),
								}
							: {}),
					}),
				}
			: {}),
		...(asset.tags && asset.tags.length > 0
			? { tags: Object.freeze(normalizeTags(asset.tags)) }
			: {}),
	};

	return Object.freeze(nextAsset);
}

function normalizeTags(tags: readonly string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const raw of tags) {
		const tag = raw.trim().toLowerCase();
		if (tag === "") continue;
		if (seen.has(tag)) continue;
		seen.add(tag);
		out.push(tag);
	}
	return out;
}

/** Query / kind / tag filter shared by the registry and the data-source path. */
export interface AssetMatchFilter {
	readonly query?: string;
	readonly kinds?: readonly AssetKind[];
	readonly tags?: readonly string[];
}

/**
 * Compile a search filter into a reusable predicate. The query string and tag
 * filter are trimmed + lowercased ONCE here, not once per candidate, so a scan
 * over N assets normalizes the filter a single time instead of N times. This is
 * the registry's search hot path — `AssetCommandPalette` re-runs a free-text
 * query on every keystroke — so build the matcher once, then apply it across the
 * list (see `runSearch`).
 *
 * Exported so the in-memory data-source compose layer applies the EXACT same
 * matching before adding its folder clause (PRD 0002 §9.2 — single source of
 * truth for search semantics).
 */
export function prepareAssetMatcher(
	options: AssetMatchFilter,
): (entry: UploadResult) => boolean {
	const query = options.query?.trim().toLowerCase() ?? "";
	const kindSet =
		options.kinds && options.kinds.length > 0
			? new Set<AssetKind>(options.kinds)
			: null;
	const tagFilter = normalizeTagFilter(options.tags);

	return (entry) => {
		if (!matchesQuery(entry, query)) return false;
		if (kindSet !== null && !kindSet.has(inferAssetKind(entry))) return false;
		if (tagFilter.length > 0 && !matchesAllTags(entry, tagFilter)) return false;
		return true;
	};
}

/** Trim + lowercase + drop-empty the query-side tag filter (query-invariant). */
function normalizeTagFilter(tags: readonly string[] | undefined): string[] {
	if (tags === undefined || tags.length === 0) return [];
	const out: string[] = [];
	for (const raw of tags) {
		const tag = raw.trim().toLowerCase();
		if (tag !== "") out.push(tag);
	}
	return out;
}

/**
 * Pure offset-cursor pagination over a pre-filtered match list. Shared by
 * `runSearch` and the folder-scoped data-source path so the cursor contract is
 * identical regardless of which clause did the filtering.
 */
export function paginateMatches(
	matches: readonly UploadResult[],
	options: { readonly cursor?: string; readonly limit?: number },
): AssetSearchPage {
	const total = matches.length;
	const limit =
		options.limit !== undefined && options.limit > 0
			? options.limit
			: DEFAULT_SEARCH_LIMIT;
	const offset = parseCursor(options.cursor);
	const slice = matches.slice(offset, offset + limit);
	const nextOffset = offset + slice.length;
	const nextCursor = nextOffset < total ? String(nextOffset) : undefined;
	return Object.freeze({
		items: Object.freeze(slice),
		total,
		nextCursor,
	});
}

function runSearch(
	assetsById: Map<string, UploadResult>,
	options: AssetSearchOptions,
): AssetSearchPage {
	const matches: UploadResult[] = [];
	const matcher = prepareAssetMatcher(options);
	for (const entry of assetsById.values()) {
		if (matcher(entry)) matches.push(entry);
	}
	return paginateMatches(matches, options);
}

function matchesQuery(entry: UploadResult, query: string): boolean {
	if (query === "") return true;
	if (entry.id.toLowerCase().includes(query)) return true;
	if (entry.name?.toLowerCase().includes(query)) return true;
	if (entry.meta?.mimeType?.toLowerCase().includes(query)) return true;
	if (entry.tags?.some((tag) => tag.toLowerCase().includes(query))) return true;
	return false;
}

function matchesAllTags(
	entry: UploadResult,
	required: readonly string[],
): boolean {
	if (entry.tags === undefined || entry.tags.length === 0) return false;
	const have = new Set(entry.tags.map((t) => t.toLowerCase()));
	for (const tag of required) {
		if (!have.has(tag)) return false;
	}
	return true;
}

function parseCursor(cursor: string | undefined): number {
	if (cursor === undefined) return 0;
	const value = Number.parseInt(cursor, 10);
	if (!Number.isFinite(value) || value < 0) return 0;
	return value;
}
