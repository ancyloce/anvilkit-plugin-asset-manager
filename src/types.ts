export interface AssetMeta {
	readonly size?: number;
	readonly mimeType?: string;
	readonly width?: number;
	readonly height?: number;
}

/**
 * Library-management kind union surfaced by `AssetRegistry.search` and
 * the sidebar filter row. Mirrors `@anvilkit/core/types`'
 * `StudioAssetKind` shape so the same filter values flow through both
 * the headless registry and the Studio surface without translation.
 */
export type AssetKind =
	| "image"
	| "video"
	| "audio"
	| "font"
	| "document"
	| "other";

export interface UploadResult {
	readonly url: string;
	readonly id: string;
	/**
	 * Optional human-readable name. The plugin's `uploadAsset()` seeds
	 * this from the source `File`'s `name` so the sidebar can render a
	 * filename under each tile; uploader adapters may also populate it
	 * directly when they know a friendlier label.
	 */
	readonly name?: string;
	readonly meta?: AssetMeta;
	/**
	 * Optional library tags. The plugin auto-derives a small set on
	 * register (kind + filename tokens); hosts may extend or replace via
	 * {@link AssetRegistry.setTags} or by attaching `tags` on a
	 * host-supplied `UploadResult`. Surfaced to the sidebar through
	 * `StudioAsset.tags` and consulted by `AssetRegistry.search`.
	 */
	readonly tags?: readonly string[];
}

export type UploadAdapter = (file: File) => Promise<UploadResult>;

export interface AssetManagerOptions {
	readonly uploader: UploadAdapter;
	readonly maxFileSize?: number;
	readonly acceptedMimeTypes?: readonly string[];
	/**
	 * Permit `data:` URLs to flow through the trust boundary. Defaults to
	 * `false` — `http`, `https`, and `blob` are always allowed; every
	 * other scheme is rejected. The previous `urlAllowlist: ["data"]`
	 * pattern is replaced by this typed flag in v1.0.
	 */
	readonly dataUrlAllowlistOptIn?: boolean;
	/**
	 * Permit `http(s)` URLs whose hostname mixes Unicode scripts (e.g.
	 * `аpple.com` blending Cyrillic and Latin). Defaults to `false` —
	 * mixed-script hostnames are rejected as a homoglyph-attack guard.
	 * Single-script IDN hosts (e.g. `münchen.de`, `日本.jp`) are always
	 * allowed regardless of this flag.
	 */
	readonly allowMixedScriptHostnames?: boolean;
	/**
	 * Optional thumbnail derivation passed to {@link createStudioAssetSource}.
	 * Returning a string sets `StudioAsset.thumbnailUrl`; returning
	 * `undefined` suppresses the thumbnail (overriding the default-for-images
	 * behavior).
	 */
	readonly getThumbnail?: (entry: UploadResult) => string | undefined;
}

/**
 * Listener invoked after every registry mutation
 * (`register` / `delete` / `rename` / `replace` / `setTags`). The
 * `studio-asset-source` adapter wires its own listener set onto the
 * registry so the sidebar re-runs `list()` whenever an asset changes.
 */
export type AssetRegistryListener = () => void;

/**
 * Search and filter options accepted by {@link AssetRegistry.search}.
 *
 * `query` matches case-insensitively against `id`, `name`, `tags`, and
 * the MIME type (prefix match — e.g. `"image"` matches `"image/png"`).
 * Filters compose with AND semantics: an entry must satisfy every
 * supplied filter to land in the page.
 */
export interface AssetSearchOptions {
	readonly query?: string;
	readonly kinds?: readonly AssetKind[];
	readonly tags?: readonly string[];
	readonly cursor?: string;
	readonly limit?: number;
}

/**
 * Pagination envelope returned by {@link AssetRegistry.search}.
 *
 * - `items` — the slice for the requested page.
 * - `total` — total number of matches across all pages (post-filter).
 * - `nextCursor` — opaque cursor for the next page, or `undefined` when
 *   the result set is exhausted.
 */
export interface AssetSearchPage {
	readonly items: readonly UploadResult[];
	readonly total: number;
	readonly nextCursor: string | undefined;
}

export interface AssetRegistry {
	readonly register: (asset: UploadResult) => UploadResult;
	readonly get: (id: string) => UploadResult | undefined;
	readonly list: () => readonly UploadResult[];
	/** Remove an asset. Returns `true` if an entry was removed. */
	readonly delete: (id: string) => boolean;
	/**
	 * Rename an asset in-place. Returns the updated entry, or `undefined`
	 * if no asset with that id exists.
	 */
	readonly rename: (id: string, name: string) => UploadResult | undefined;
	/**
	 * Replace an asset in-place. Preserves the entry's `id` even if the
	 * incoming `next` carries a different one. Returns the updated entry,
	 * or `undefined` if no asset with that id exists.
	 */
	readonly replace: (
		id: string,
		next: UploadResult,
	) => UploadResult | undefined;
	/**
	 * Replace the tag set on an asset in-place. Empty arrays drop the
	 * `tags` field entirely. Tags are deduped, trimmed, lowercased, and
	 * frozen before storage. Returns the updated entry, or `undefined`
	 * if no asset with that id exists.
	 */
	readonly setTags: (
		id: string,
		tags: readonly string[],
	) => UploadResult | undefined;
	/**
	 * Search and paginate the registry. See {@link AssetSearchOptions}
	 * for filter semantics.
	 */
	readonly search: (options?: AssetSearchOptions) => AssetSearchPage;
	/**
	 * Subscribe to mutation notifications. The returned function
	 * unsubscribes the listener.
	 */
	readonly subscribe: (listener: AssetRegistryListener) => () => void;
}
