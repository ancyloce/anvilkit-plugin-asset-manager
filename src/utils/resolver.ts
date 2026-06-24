import type {
	AssetResolution,
	IRAssetResolver,
	PageIR,
	PageIRAsset,
	PageIRNode,
} from "@anvilkit/core/types";
import type { TransformResolver } from "../types/transform.js";
import type { AssetRegistry } from "../types/types.js";
import { parseAssetReference } from "./asset-reference.js";
import { AssetResolutionError, AssetValidationError } from "./errors.js";
import { validateUploadResult } from "./validate-upload-result.js";

const URL_REJECTION_VALIDATION_CODES = new Set([
	"EMPTY_UPLOAD_URL",
	"UNSCHEMED_UPLOAD_URL",
	"DISALLOWED_UPLOAD_URL_SCHEME",
	"INVALID_UPLOAD_ID",
	"PATH_TRAVERSAL_URL",
	"MIXED_SCRIPT_HOSTNAME",
]);

const ASSET_PROP_KEYS = new Set([
	"src",
	"imageUrl",
	"imageSrc",
	"url",
	"videoUrl",
	"videoSrc",
	"fontUrl",
	"scriptUrl",
	"styleUrl",
	"backgroundSrc",
	"backgroundImage",
	"poster",
	"thumbnailSrc",
]);

/** Options for creating an IR asset-reference resolver. */
export interface CreateIRAssetResolverOptions {
	readonly registry: AssetRegistry;
	readonly dataUrlAllowlistOptIn?: boolean;
	readonly allowMixedScriptHostnames?: boolean;
	/**
	 * Maps an asset + transform (carried on the reference as `?w=…&fm=…`) to a
	 * derivative URL. When omitted, or when it returns `undefined`, the asset's
	 * original URL is used. The derivative URL is re-validated through the same
	 * trust boundary as any resolved asset URL.
	 */
	readonly transformResolver?: TransformResolver;
}

/**
 * Create an IR asset resolver for `asset://<id>` references.
 *
 * The resolver looks up references in the supplied registry, re-validates the
 * stored URL at export/render time, and translates lookup or validation failures
 * into `AssetResolutionError` codes for callers that need actionable export
 * diagnostics.
 */
export function createIRAssetResolver(
	options: CreateIRAssetResolverOptions,
): IRAssetResolver {
	return (url) => {
		const parsed = parseAssetReference(url);
		if (parsed === null) {
			return null;
		}
		const assetId = parsed.id;

		const asset = options.registry.get(assetId);
		if (!asset) {
			throw new AssetResolutionError(assetId, "ASSET_NOT_FOUND");
		}

		try {
			// Apply a requested transform via the host resolver. A derivative URL
			// is re-validated below exactly like the original, so a hostile
			// derivative can't bypass the trust boundary.
			let effectiveUrl = asset.url;
			let transformApplied = false;
			if (
				parsed.transform !== undefined &&
				options.transformResolver !== undefined
			) {
				const derived = options.transformResolver(asset, parsed.transform);
				if (derived !== undefined) {
					effectiveUrl = derived;
					transformApplied = true;
				}
			}

			const validated = validateUploadResult(
				{
					id: asset.id,
					url: effectiveUrl,
					...(asset.meta ? { meta: asset.meta } : {}),
				},
				{
					dataUrlAllowlistOptIn: options.dataUrlAllowlistOptIn,
					allowMixedScriptHostnames: options.allowMixedScriptHostnames,
				},
			);

			// A derivative URL has host-determined dimensions / size / format, so
			// the original `size`/`width`/`height`/`mimeType`/`hash` are stale —
			// drop them, but KEEP `attribution`, which is about the source image
			// and survives a resize (e.g. a required Unsplash credit).
			const meta =
				transformApplied && validated.meta
					? validated.meta.attribution !== undefined
						? { attribution: validated.meta.attribution }
						: undefined
					: validated.meta;

			const resolution: AssetResolution = {
				url: validated.url,
				...(meta ? { meta: meta as Readonly<Record<string, unknown>> } : {}),
			};

			return resolution;
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: `Could not resolve asset "${assetId}"`;
			const code: "ASSET_URL_REJECTED" | "ASSET_VALIDATION_FAILED" =
				error instanceof AssetValidationError &&
				URL_REJECTION_VALIDATION_CODES.has(error.code)
					? "ASSET_URL_REJECTED"
					: "ASSET_VALIDATION_FAILED";
			throw new AssetResolutionError(assetId, code, message, { cause: error });
		}
	};
}

/**
 * Resolve all asset references found in a Page IR tree.
 *
 * The function scans the IR asset table and asset-like node props, resolves each
 * distinct URL concurrently with the supplied resolver, clones the IR with any
 * resolved URLs/meta applied, and returns a deeply frozen result.
 */
export async function resolveAssets(
	ir: PageIR,
	resolver: IRAssetResolver,
): Promise<PageIR> {
	const rewriteMap = new Map<string, AssetResolution>();
	const assetUrls = collectAssetUrls(ir);

	// Resolve every URL concurrently — each lookup is independent and the
	// results land in a Map keyed by URL, so order does not matter. A serial
	// await-in-loop would pay each resolver's latency back-to-back.
	const resolutions = await Promise.all(
		Array.from(assetUrls, async (url) => [url, await resolver(url)] as const),
	);
	for (const [url, resolution] of resolutions) {
		if (resolution !== null) {
			rewriteMap.set(url, resolution);
		}
	}

	const nextIr: PageIR = {
		version: ir.version,
		root: cloneNode(ir.root, rewriteMap),
		assets: ir.assets.map((asset) => cloneAsset(asset, rewriteMap)),
		metadata: { ...ir.metadata },
	};

	return deepFreeze(nextIr);
}

function collectAssetUrls(ir: PageIR): ReadonlySet<string> {
	const urls = new Set<string>();

	for (const asset of ir.assets) {
		if (asset.url.trim() !== "") {
			urls.add(asset.url);
		}
	}

	collectNodeAssetUrls(ir.root, urls);
	return urls;
}

function collectNodeAssetUrls(node: PageIRNode, urls: Set<string>): void {
	collectValueAssetUrls(node.props, urls);

	if (node.assets) {
		for (const asset of node.assets) {
			if (asset.url.trim() !== "") {
				urls.add(asset.url);
			}
		}
	}

	if (node.children) {
		for (const child of node.children) {
			collectNodeAssetUrls(child, urls);
		}
	}
}

function collectValueAssetUrls(
	value: unknown,
	urls: Set<string>,
	key?: string,
): void {
	if (Array.isArray(value)) {
		for (const item of value) {
			collectValueAssetUrls(item, urls);
		}
		return;
	}

	if (typeof value === "string") {
		if (key !== undefined && ASSET_PROP_KEYS.has(key) && value.trim() !== "") {
			urls.add(value);
		}
		return;
	}

	if (value === null || typeof value !== "object") {
		return;
	}

	for (const [entryKey, entryValue] of Object.entries(
		value as Record<string, unknown>,
	)) {
		collectValueAssetUrls(entryValue, urls, entryKey);
	}
}

function cloneNode(
	node: PageIRNode,
	rewriteMap: ReadonlyMap<string, AssetResolution>,
): PageIRNode {
	return {
		id: node.id,
		type: node.type,
		props: cloneProps(node.props, rewriteMap),
		...(node.children
			? { children: node.children.map((child) => cloneNode(child, rewriteMap)) }
			: {}),
		...(node.assets
			? { assets: node.assets.map((asset) => cloneAsset(asset, rewriteMap)) }
			: {}),
	};
}

function cloneAsset(
	asset: PageIRAsset,
	rewriteMap: ReadonlyMap<string, AssetResolution>,
): PageIRAsset {
	const resolution = rewriteMap.get(asset.url);
	return {
		id: asset.id,
		kind: asset.kind,
		url: resolution?.url ?? asset.url,
		...((resolution?.meta ?? asset.meta)
			? { meta: resolution?.meta ?? asset.meta }
			: {}),
	};
}

/**
 * Clone a node's props with the same URL-rewrite pass as {@link cloneValue}
 * but with a precise object return type, so callers don't need an
 * `as Record<string, unknown>` assertion.
 */
function cloneProps(
	props: Readonly<Record<string, unknown>>,
	rewriteMap: ReadonlyMap<string, AssetResolution>,
): Readonly<Record<string, unknown>> {
	const next: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(props)) {
		next[key] = cloneValue(value, rewriteMap, key);
	}
	return next;
}

function cloneValue(
	value: unknown,
	rewriteMap: ReadonlyMap<string, AssetResolution>,
	key?: string,
): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => cloneValue(item, rewriteMap));
	}

	if (typeof value === "string") {
		if (key !== undefined && !ASSET_PROP_KEYS.has(key)) {
			return value;
		}

		return rewriteMap.get(value)?.url ?? value;
	}

	if (value === null || typeof value !== "object") {
		return value;
	}

	const nextValue: Record<string, unknown> = {};
	for (const [entryKey, entryValue] of Object.entries(
		value as Record<string, unknown>,
	)) {
		nextValue[entryKey] = cloneValue(entryValue, rewriteMap, entryKey);
	}

	return nextValue;
}

function deepFreeze<T>(value: T): T {
	if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
		return value;
	}

	Object.freeze(value);
	for (const entry of Object.values(value as Record<string, unknown>)) {
		deepFreeze(entry);
	}

	return value;
}
