/**
 * @file Unified categorization & filtering model (PRD 0002 §3.2, §9).
 *
 * `AssetSearchOptions` (the historic 5-field query in `./types.ts`) is retained
 * verbatim; {@link AssetFilter} EXTENDS it additively, so every existing caller
 * keeps compiling while new code gains folder/source/facet/sort axes. The page
 * envelope {@link AssetListPage} likewise extends the existing `AssetSearchPage`
 * with a unified folder view (`folders` + `folderPath`) so a single `list()`
 * returns assets, child folders, and the breadcrumb — no separate `listFolders`.
 */

import type { AssetFolder, FolderId } from "./folders.js";
import type { AssetSearchOptions, AssetSearchPage } from "./types.js";

/**
 * Stable source identifiers. Branded so a typo is a type error while hosts can
 * still introduce their own ids (e.g. `"brandfolder"`).
 */
export type AssetSourceId = "local" | "unsplash" | (string & {});

export type AssetSortField = "recent" | "name" | "size" | "kind" | "relevance";

/** Sort selection for asset search and list queries. */
export interface AssetSort {
	readonly field: AssetSortField;
	/** Defaults are field-appropriate: `recent`→`desc`, `name`→`asc`. */
	readonly direction?: "asc" | "desc";
}

/**
 * The single, unified query passed to every filterable surface. All fields are
 * optional and compose with AND semantics (an asset must satisfy every supplied
 * axis), extending the existing `runSearch()` conjunction.
 */
export interface AssetFilter extends AssetSearchOptions {
	/** Scope to a folder. `null` ⇒ root only; `undefined` ⇒ any folder. */
	readonly folderId?: FolderId | null;
	/** When true, include assets in descendant folders too. Default false. */
	readonly recursive?: boolean;
	/** Restrict to one or more sources. `undefined` ⇒ federate across all. */
	readonly sources?: readonly AssetSourceId[];
	/** Host-registered facet selections, keyed by facet id. */
	readonly facets?: Readonly<Record<string, readonly string[]>>;
	/** Sort. Defaults to `{ field: "recent", direction: "desc" }`. */
	readonly sort?: AssetSort;
}

/**
 * Page envelope: `AssetSearchPage` (assets, paginated) plus the unified folder
 * view. `folders`/`folderPath` ride OUTSIDE the asset cursor/`limit` (folders
 * are few and returned whole per scope); only `items` paginates. A flat source
 * omits the folder fields.
 */
export interface AssetListPage extends AssetSearchPage {
	/** Child folders of `query.folderId` (or the whole sub-tree when `recursive`). */
	readonly folders?: readonly AssetFolder[];
	/** Root → … → current folder, for the breadcrumb. Omitted at root. */
	readonly folderPath?: readonly AssetFolder[];
	/** Per-source page tokens for federated paging, keyed by source id. */
	readonly sourceCursors?: Readonly<Record<string, string | undefined>>;
	/**
	 * Per-source errors for a federated page, keyed by source id — set when a
	 * provider failed for this page while others succeeded (the failed provider's
	 * items are dropped but its cursor is carried forward). Mirrors core's
	 * `StudioAssetListPage.sourceErrors`.
	 */
	readonly sourceErrors?: Readonly<
		Record<string, { readonly message: string; readonly code?: string }>
	>;
}
