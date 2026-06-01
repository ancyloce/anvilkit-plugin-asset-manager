/**
 * @file The asset-manager plugin's public options surface (PRD 0002 §4).
 *
 * Hoisted out of `types.ts` into its own module so it can aggregate the new
 * data-source / folder / provider / category / Unsplash contracts WITHOUT
 * forming an import cycle (those modules depend on `types.ts`; this one sits
 * above them). The public name `AssetManagerOptions` is unchanged and
 * re-exported from the package barrel — a pure relocation, not a rename.
 */

import type { AssetSourceProvider } from "../sources/provider.js";
import type { AssetCategory, AssetFacetDefinition } from "./categories.js";
import type { AssetDataSource } from "./data-source.js";
import type { FolderOptions } from "./folders.js";
import type { UploadAdapter, UploadResult } from "./types.js";
import type { UnsplashSourceOptions } from "./unsplash.js";

export interface AssetManagerOptions {
	/**
	 * Binary ingest: `File → UploadResult`. WIDENED to optional in PRD 0002 —
	 * omitted ⇒ the plugin resolves the built-in `inMemoryUploader()`, so
	 * `createAssetManagerPlugin()` works with zero config. The resolved value is
	 * always non-optional internally; every existing `{ uploader }` caller still
	 * assigns (pure widening).
	 */
	readonly uploader?: UploadAdapter;
	/**
	 * Unified local-library data plane (list + asset/folder CRUD). Omitted ⇒ a
	 * full in-memory default over the built-in registry + a folder side-index.
	 */
	readonly dataSource?: AssetDataSource;
	/**
	 * Enable folder management. `true` (default) ⇒ in-memory folder store;
	 * `false` ⇒ flat library (today's UX); an object tunes depth / move.
	 */
	readonly folders?: boolean | FolderOptions;
	/** Additional external read-only sources (federated tabs, e.g. Unsplash). */
	readonly providers?: readonly AssetSourceProvider[];
	/**
	 * Built-in Unsplash source config — sugar that builds + registers an Unsplash
	 * provider. Enabled when a proxy endpoint or access key is present; the
	 * package never bundles a key.
	 */
	readonly unsplash?: UnsplashSourceOptions;
	/** Host saved-view chips shown beside the kind chips. */
	readonly categories?: readonly AssetCategory[];
	/** Host-registered custom facets, merged onto the built-ins. */
	readonly facets?: readonly AssetFacetDefinition[];

	// ── existing optional fields (unchanged from the original AssetManagerOptions) ──
	readonly maxFileSize?: number;
	readonly acceptedMimeTypes?: readonly string[];
	/**
	 * Permit `data:` URLs through the trust boundary. Defaults to `false` —
	 * `http`, `https`, and `blob` are always allowed; every other scheme is
	 * rejected. Replaced the previous `urlAllowlist: ["data"]` pattern in v1.0.
	 */
	readonly dataUrlAllowlistOptIn?: boolean;
	/**
	 * Permit `http(s)` URLs whose hostname mixes Unicode scripts. Defaults to
	 * `false` (homoglyph-attack guard). Single-script IDN hosts are always
	 * allowed regardless of this flag.
	 */
	readonly allowMixedScriptHostnames?: boolean;
	/**
	 * Optional thumbnail derivation. Returning a string sets
	 * `StudioAsset.thumbnailUrl`; returning `undefined` suppresses the thumbnail
	 * (overriding the default-for-images behavior).
	 */
	readonly getThumbnail?: (entry: UploadResult) => string | undefined;
}
