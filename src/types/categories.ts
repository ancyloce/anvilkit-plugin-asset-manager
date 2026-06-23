/**
 * @file Extensible categorization / facet registry (PRD 0002 §3.5, §9.2).
 *
 * `kind`, `tags`, `folder`, and `source` are built-in facets registered by the
 * plugin; hosts append {@link AssetFacetDefinition}s rather than reconfigure.
 * {@link AssetCategory} is a host-friendly "saved view" sugar over filters and
 * providers, surfaced as chips beside the kind chips.
 */

import type { AssetSourceId } from "./filter.js";
import type { AssetKind, UploadResult } from "./types.js";

/** One selectable option within an asset facet filter. */
export interface AssetFacetOption {
	readonly value: string;
	readonly label: string;
	/** Populated by memoized facet counts when available. */
	readonly count?: number;
}

/** Describes a facet filter available in the asset browser. */
export interface AssetFacetDefinition {
	/** Stable key; used in `AssetFilter.facets[id]`. */
	readonly id: string;
	readonly label: string;
	/** `"single"` renders as chips/radio; `"multi"` as a multiselect. */
	readonly selection: "single" | "multi";
	/** Which sources this facet applies to. `undefined` ⇒ all. */
	readonly appliesTo?: readonly AssetSourceId[];
	/** Derive the asset's value(s) for this facet (local, sync). */
	readonly valueOf?: (asset: UploadResult) => readonly string[] | undefined;
	/** Static options, or an async loader for remote facets (e.g. Unsplash topics). */
	readonly options?:
		| readonly AssetFacetOption[]
		| ((ctx: {
				readonly source?: AssetSourceId;
		  }) => Promise<readonly AssetFacetOption[]>);
	/** When true, the facet is delegated to the source instead of matched locally. */
	readonly remote?: boolean;
}

/** Top-level asset category exposed to the browser UI. */
export interface AssetCategory {
	readonly id: string;
	readonly label: string;
	/** Local match composed with AND-semantic search. */
	readonly match?: {
		readonly tags?: readonly string[];
		readonly kinds?: readonly AssetKind[];
	};
	/** Route the category to an external provider/theme instead of a local match. */
	readonly provider?: {
		readonly source: AssetSourceId;
		readonly theme?: string;
	};
}
