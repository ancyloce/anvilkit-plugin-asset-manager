/**
 * @file Canonical `asset://<id>` reference codec.
 *
 * Lives in its own file so both `plugin.ts` (which dispatches asset references
 * into Puck data) and `resolver.ts` / `studio-asset-source.ts` can reuse it
 * without a circular import. A reference may carry an optional transform query
 * (`asset://<id>?w=800&fm=webp`) requesting a derivative rendition; the IR
 * resolver decodes it and maps it to a derivative URL via the host's
 * `TransformResolver` (review finding #9).
 */

import type { AssetTransform } from "../types/transform.js";

const ASSET_REFERENCE_PREFIX = "asset://";

/**
 * Build the opaque `asset://<id>` reference stored in page data for an asset.
 * The IR resolver ({@link createIRAssetResolver}) turns it back into a validated
 * URL at export / render time; it is never a directly-loadable URL itself.
 *
 * Pass a {@link AssetTransform} to request a derivative rendition — it is
 * encoded as a stable query (`?w=&h=&fit=&fm=&q=&dpr=`) and applied by the
 * resolver's configured `TransformResolver`.
 */
export function createAssetReference(
	id: string,
	transform?: AssetTransform,
): string {
	const base = `${ASSET_REFERENCE_PREFIX}${encodeId(id)}`;
	if (transform === undefined) return base;
	const query = encodeTransform(transform);
	return query === "" ? base : `${base}?${query}`;
}

/** Parsed components of an `asset://` reference. */
export interface ParsedAssetReference {
	readonly id: string;
	/** Present only when the reference carried a (well-formed) transform query. */
	readonly transform?: AssetTransform;
}

/**
 * Parse an `asset://<id>[?transform]` reference. Returns `null` for any non-
 * asset URL or an empty id. Malformed transform params are ignored rather than
 * failing the parse (references can be host- or tamper-supplied).
 */
export function parseAssetReference(url: string): ParsedAssetReference | null {
	if (!url.startsWith(ASSET_REFERENCE_PREFIX)) return null;
	const rest = url.slice(ASSET_REFERENCE_PREFIX.length);
	const queryIndex = rest.indexOf("?");
	const id = decodeId(
		(queryIndex === -1 ? rest : rest.slice(0, queryIndex)).trim(),
	);
	if (id === "") return null;
	if (queryIndex === -1) return { id };
	const transform = decodeTransform(rest.slice(queryIndex + 1));
	return transform === undefined ? { id } : { id, transform };
}

// Escape ONLY the query/fragment delimiters (and `%` so decoding is
// unambiguous) so an id containing `?`/`#` round-trips and never gets
// misread as a transform query. `:` is intentionally left untouched, so
// existing references like `asset://unsplash:<id>` stay byte-identical.
function encodeId(id: string): string {
	return id.replace(/%/g, "%25").replace(/\?/g, "%3F").replace(/#/g, "%23");
}

function decodeId(id: string): string {
	return id.replace(/%3F/gi, "?").replace(/%23/gi, "#").replace(/%25/g, "%");
}

const FITS = new Set<AssetTransform["fit"]>([
	"cover",
	"contain",
	"fill",
	"inside",
	"outside",
]);
const FORMATS = new Set<AssetTransform["format"]>([
	"webp",
	"avif",
	"jpeg",
	"png",
	"auto",
]);

function encodeTransform(transform: AssetTransform): string {
	const params = new URLSearchParams();
	if (transform.width !== undefined) params.set("w", String(transform.width));
	if (transform.height !== undefined) params.set("h", String(transform.height));
	if (transform.fit !== undefined) params.set("fit", transform.fit);
	if (transform.format !== undefined) params.set("fm", transform.format);
	if (transform.quality !== undefined)
		params.set("q", String(transform.quality));
	if (transform.dpr !== undefined) params.set("dpr", String(transform.dpr));
	return params.toString();
}

function decodeTransform(query: string): AssetTransform | undefined {
	const params = new URLSearchParams(query);
	const out: {
		-readonly [K in keyof AssetTransform]?: AssetTransform[K];
	} = {};
	// Pixel dimensions are positive integers; reject decimals / scientific
	// notation / non-positive values.
	const width = toPositiveInteger(params.get("w"));
	if (width !== undefined) out.width = width;
	const height = toPositiveInteger(params.get("h"));
	if (height !== undefined) out.height = height;
	const fit = params.get("fit");
	if (FITS.has(fit as AssetTransform["fit"])) {
		out.fit = fit as AssetTransform["fit"];
	}
	const format = params.get("fm");
	if (FORMATS.has(format as AssetTransform["format"])) {
		out.format = format as AssetTransform["format"];
	}
	// Quality is a 1–100 integer per the contract.
	const quality = toPositiveInteger(params.get("q"));
	if (quality !== undefined && quality <= 100) out.quality = quality;
	// DPR may be fractional (e.g. 1.5, 2), so a positive finite number.
	const dpr = toPositiveNumber(params.get("dpr"));
	if (dpr !== undefined) out.dpr = dpr;
	return Object.keys(out).length > 0 ? out : undefined;
}

// Plain decimal forms only — reject `1e3`, `0x10`, signs, whitespace, etc., so
// `Number()`'s permissive coercion can't slip non-decimal syntax past the
// integer / numeric contract.
const DECIMAL_INTEGER_RE = /^[0-9]+$/;
const DECIMAL_NUMBER_RE = /^[0-9]+(?:\.[0-9]+)?$/;

function toPositiveInteger(value: string | null): number | undefined {
	if (value === null || !DECIMAL_INTEGER_RE.test(value)) return undefined;
	const n = Number(value);
	// `Number.isSafeInteger` rejects the digit-only-but-overflowing case
	// (e.g. 400 nines → `Infinity`) and caps at 2^53 — beyond any real dimension.
	return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

function toPositiveNumber(value: string | null): number | undefined {
	if (value === null || !DECIMAL_NUMBER_RE.test(value)) return undefined;
	const n = Number(value);
	return Number.isFinite(n) && n > 0 ? n : undefined;
}
