/**
 * @file External read-only source provider contract (PRD 0002 §3.4, §8).
 *
 * Unsplash (and any host-defined stock source) implements this. All providers
 * compose behind the single `StudioAssetSource` the plugin registers; the
 * built-in `local` provider wraps the resolved `AssetDataSource`. These are
 * types only — erased at runtime, zero bytes in any chunk.
 */

import type { StudioAsset } from "@anvilkit/core/types";

import type {
	AssetFilter,
	AssetListPage,
	AssetSourceId,
} from "../types/filter.js";
import type { UploadResult } from "../types/types.js";

export interface AssetSourceCapabilities {
	readonly searchable: boolean;
	readonly themed: boolean;
	/** Unsplash = false (browse + insert only). */
	readonly mutable: boolean;
	/** Unsplash = true. */
	readonly requiresAttribution: boolean;
}

export interface AssetTheme {
	readonly id: string;
	/** i18n message key (not inline copy). */
	readonly label: string;
	readonly description?: string;
}

export interface AssetSourceProvider {
	/** `"unsplash"` | host id. The built-in `"local"` provider wraps the data source. */
	readonly id: AssetSourceId;
	readonly label: string;
	readonly capabilities: AssetSourceCapabilities;
	/** Content-Security-Policy hosts this provider needs (e.g. Unsplash img/connect src). */
	readonly requiredCsp?: () => {
		readonly connectSrc?: readonly string[];
		readonly imgSrc?: readonly string[];
	};
	listThemes(): readonly AssetTheme[] | Promise<readonly AssetTheme[]>;
	search(
		query: AssetFilter,
		page: string | undefined,
		signal?: AbortSignal,
	): Promise<AssetListPage>;
	/**
	 * Convert a browsed result into a real asset (fires the source's
	 * download-trigger / attribution work) and feed it into the existing
	 * registry → IR → `asset://` pipeline.
	 */
	pickResult(asset: StudioAsset, signal?: AbortSignal): Promise<UploadResult>;
}
