/**
 * @file Asset transformation contract (PRD 0004 — review finding #9).
 *
 * A headless, processing-free transformation seam. The plugin never resizes or
 * transcodes bytes itself (it has no storage either — uploads go through host
 * adapters); instead a transform is a declarative spec carried alongside an
 * `asset://<id>` reference, and a host-pluggable {@link TransformResolver} maps
 * `(asset, transform)` to a derivative URL produced by the host's image CDN /
 * service (imgix, Cloudinary, S3 + Lambda, …). The built-in
 * `createQueryParamTransformResolver` covers the common query-param CDN case.
 *
 * @experimental Public surface may change before v1.0.
 */

import type { UploadResult } from "./types.js";

/**
 * A declarative, backend-neutral image transformation request. All fields are
 * optional; a resolver maps the ones it supports onto its CDN's vocabulary and
 * ignores the rest.
 */
export interface AssetTransform {
	/** Target width in pixels. */
	readonly width?: number;
	/** Target height in pixels. */
	readonly height?: number;
	/**
	 * How the image fills the target box when both `width` and `height` are set.
	 * Names follow the common CDN/sharp vocabulary; a resolver maps them onto its
	 * own parameter values.
	 */
	readonly fit?: "cover" | "contain" | "fill" | "inside" | "outside";
	/** Output format. `"auto"` lets the CDN negotiate (e.g. WebP/AVIF by Accept). */
	readonly format?: "webp" | "avif" | "jpeg" | "png" | "auto";
	/** Output quality, 1–100. */
	readonly quality?: number;
	/** Device pixel ratio multiplier (e.g. `2` for retina). */
	readonly dpr?: number;
}

/**
 * Host-pluggable mapping from an asset + transform spec to a derivative URL.
 * Return `undefined` to fall back to the asset's original URL (e.g. the
 * transform isn't supported, or the asset isn't an image). The returned URL is
 * re-validated through the same trust boundary as any other resolved asset URL.
 */
export type TransformResolver = (
	asset: UploadResult,
	transform: AssetTransform,
) => string | undefined;
