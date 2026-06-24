/**
 * @file Built-in query-param {@link TransformResolver} (PRD 0004 — review #9).
 *
 * Maps an {@link AssetTransform} onto query parameters appended to the asset's
 * URL — the shape most image CDNs accept (imgix, Cloudinary's `f_`/`w_` via a
 * mapper, Thumbor-ish gateways, etc.). Param names and the `fit`/`format`
 * vocabularies are configurable so one helper covers many CDNs. Lives on its
 * own `./transform` subpath so flat callers never pull it into the eager entry.
 *
 * @experimental Public surface may change before v1.0.
 */

import type { AssetTransform, TransformResolver } from "../types/transform.js";
import type { UploadResult } from "../types/types.js";

/**
 * Resolve a derivative URL for an asset + transform using `resolver`, falling
 * back to the asset's original URL when the resolver returns `undefined`. The
 * live (non-IR) counterpart to what `createIRAssetResolver` does at export /
 * render time — useful for a host rendering a variant directly.
 */
export function deriveVariantUrl(
	asset: UploadResult,
	transform: AssetTransform,
	resolver: TransformResolver,
): string {
	return resolver(asset, transform) ?? asset.url;
}

/** Configuration for {@link createQueryParamTransformResolver}. */
export interface QueryParamTransformResolverOptions {
	/**
	 * Override the query parameter names. Defaults to an imgix-style set:
	 * `w` / `h` / `fit` / `fm` / `q` / `dpr`.
	 */
	readonly params?: {
		readonly width?: string;
		readonly height?: string;
		readonly fit?: string;
		readonly format?: string;
		readonly quality?: string;
		readonly dpr?: string;
	};
	/** Map the `fit` vocabulary onto the CDN's values (e.g. `cover` → `crop`). */
	readonly fitMap?: Partial<Record<NonNullable<AssetTransform["fit"]>, string>>;
	/** Map the `format` vocabulary onto the CDN's values. */
	readonly formatMap?: Partial<
		Record<NonNullable<AssetTransform["format"]>, string>
	>;
}

/**
 * Create a {@link TransformResolver} that appends transform query parameters to
 * each asset's URL, preserving any existing query. Returns `undefined` (→ the
 * original URL) when the transform is empty, so a no-op transform is a no-op.
 */
export function createQueryParamTransformResolver(
	options: QueryParamTransformResolverOptions = {},
): TransformResolver {
	const names = {
		width: options.params?.width ?? "w",
		height: options.params?.height ?? "h",
		fit: options.params?.fit ?? "fit",
		format: options.params?.format ?? "fm",
		quality: options.params?.quality ?? "q",
		dpr: options.params?.dpr ?? "dpr",
	};

	return (asset, transform) => {
		const params: Array<readonly [string, string]> = [];
		if (transform.width !== undefined) {
			params.push([names.width, String(transform.width)]);
		}
		if (transform.height !== undefined) {
			params.push([names.height, String(transform.height)]);
		}
		if (transform.fit !== undefined) {
			params.push([
				names.fit,
				options.fitMap?.[transform.fit] ?? transform.fit,
			]);
		}
		if (transform.format !== undefined) {
			params.push([
				names.format,
				options.formatMap?.[transform.format] ?? transform.format,
			]);
		}
		if (transform.quality !== undefined) {
			params.push([names.quality, String(transform.quality)]);
		}
		if (transform.dpr !== undefined) {
			params.push([names.dpr, String(transform.dpr)]);
		}
		if (params.length === 0) return undefined;
		return appendQueryParams(asset.url, params);
	};
}

function appendQueryParams(
	rawUrl: string,
	params: ReadonlyArray<readonly [string, string]>,
): string {
	try {
		// Absolute URL: let URLSearchParams handle encoding, existing query, and
		// fragment ordering. `set` replaces an existing same-name param.
		const url = new URL(rawUrl);
		for (const [key, value] of params) url.searchParams.set(key, value);
		return url.toString();
	} catch {
		// Relative URL: split off any fragment, merge into the existing query
		// (replacing same-name params, like the absolute path), reattach the
		// fragment. Reconstructing by hand avoids the leading-slash mangling a
		// dummy-base `new URL()` would introduce for path-relative URLs.
		const hashIndex = rawUrl.indexOf("#");
		const hash = hashIndex === -1 ? "" : rawUrl.slice(hashIndex);
		const beforeHash = hashIndex === -1 ? rawUrl : rawUrl.slice(0, hashIndex);
		const queryIndex = beforeHash.indexOf("?");
		const path =
			queryIndex === -1 ? beforeHash : beforeHash.slice(0, queryIndex);
		const search = new URLSearchParams(
			queryIndex === -1 ? "" : beforeHash.slice(queryIndex + 1),
		);
		for (const [key, value] of params) search.set(key, value);
		const query = search.toString();
		return `${path}${query === "" ? "" : `?${query}`}${hash}`;
	}
}
