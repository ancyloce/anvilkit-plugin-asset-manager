export interface AssetMeta {
	readonly size?: number;
	readonly mimeType?: string;
	readonly width?: number;
	readonly height?: number;
	/**
	 * Optional provenance/attribution for externally-sourced assets (PRD 0002
	 * §8.4). Set when an asset is inserted from a credit-requiring provider such
	 * as Unsplash; export plugins read it to emit the required photographer +
	 * source credit. NOTE: the in-memory registry's freeze reconstructor is
	 * extended to preserve this field in Phase 1 (M5); the type is additive here.
	 */
	readonly attribution?: {
		/**
		 * Provider that requires the credit. Open string union: `"unsplash"`
		 * keeps autocomplete while a future credit-requiring provider (Pexels,
		 * etc.) can set its own id without a breaking type change. Mirrors the
		 * `AssetSourceId` idiom.
		 */
		readonly source: "unsplash" | (string & {});
		readonly photographerName: string;
		readonly photographerUrl: string;
		readonly unsplashUrl: string;
		readonly photoUrl: string;
		readonly downloadLocation: string;
	};
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

/**
 * Options passed to an {@link UploadAdapter}. Currently carries an
 * optional `AbortSignal` so a cancelled upload batch can short-circuit
 * the adapter (network request, image decode). Adapters may ignore it.
 */
export interface UploadAdapterOptions {
	readonly signal?: AbortSignal;
}

export type UploadAdapter = (
	file: File,
	options?: UploadAdapterOptions,
) => Promise<UploadResult>;

// `AssetManagerOptions` is defined in `./options.ts` (hoisted there so it can
// aggregate the data-source / folder / provider / category contracts without
// forming an import cycle). It is re-exported from the package barrel under the
// same name. The `Pick<AssetManagerOptions, "acceptedMimeTypes" | "maxFileSize">`
// trust-boundary subset used by `validate-upload-result.ts` imports from there.

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
