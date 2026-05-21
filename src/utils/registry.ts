import { inferAssetKind } from "./infer-kind.js";
import type {
  AssetRegistry,
  AssetRegistryListener,
  AssetSearchOptions,
  AssetSearchPage,
  UploadResult,
} from "../types/types.js";

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

function runSearch(
  assetsById: Map<string, UploadResult>,
  options: AssetSearchOptions,
): AssetSearchPage {
  const query = options.query?.trim().toLowerCase() ?? "";
  const kindFilter =
    options.kinds && options.kinds.length > 0 ? options.kinds : undefined;
  const tagFilter =
    options.tags && options.tags.length > 0
      ? options.tags.map((t) => t.trim().toLowerCase()).filter((t) => t !== "")
      : undefined;

  const matches: UploadResult[] = [];
  for (const entry of assetsById.values()) {
    if (!matchesQuery(entry, query)) continue;
    if (
      kindFilter !== undefined &&
      !kindFilter.includes(inferAssetKind(entry))
    ) {
      continue;
    }
    if (tagFilter !== undefined && !matchesAllTags(entry, tagFilter)) {
      continue;
    }
    matches.push(entry);
  }

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
