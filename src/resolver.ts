import type {
	AssetResolution,
	IRAssetResolver,
	PageIR,
	PageIRAsset,
	PageIRNode,
} from "@anvilkit/core/types";

import { AssetResolutionError } from "./errors.js";
import type { AssetRegistry } from "./types.js";
import { validateUploadResult } from "./validate-upload-result.js";

const ASSET_REFERENCE_PREFIX = "asset://";
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

export interface CreateIRAssetResolverOptions {
	readonly registry: AssetRegistry;
	readonly urlAllowlist?: readonly string[];
}

export function createIRAssetResolver(
	options: CreateIRAssetResolverOptions,
): IRAssetResolver {
	return (url) => {
		const assetId = parseAssetReference(url);
		if (assetId === null) {
			return null;
		}

		const asset = options.registry.get(assetId);
		if (!asset) {
			throw new AssetResolutionError(assetId);
		}

		try {
			const validated = validateUploadResult(
				{
					id: asset.id,
					url: asset.url,
					...(asset.meta ? { meta: asset.meta } : {}),
				},
				{ urlAllowlist: options.urlAllowlist },
			);

			const resolution: AssetResolution = {
				url: validated.url,
				...(validated.meta
					? {
							meta: validated.meta as Readonly<Record<string, unknown>>,
						}
					: {}),
			};

			return resolution;
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: `Could not resolve asset "${assetId}"`;
			throw new AssetResolutionError(assetId, message, { cause: error });
		}
	};
}

export async function resolveAssets(
	ir: PageIR,
	resolver: IRAssetResolver,
): Promise<PageIR> {
	const rewriteMap = new Map<string, AssetResolution>();
	const assetUrls = collectAssetUrls(ir);

	for (const url of assetUrls) {
		const resolution = await resolver(url);
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

function parseAssetReference(url: string): string | null {
	if (!url.startsWith(ASSET_REFERENCE_PREFIX)) {
		return null;
	}

	const assetId = url.slice(ASSET_REFERENCE_PREFIX.length).trim();
	return assetId === "" ? null : assetId;
}

function cloneNode(
	node: PageIRNode,
	rewriteMap: ReadonlyMap<string, AssetResolution>,
): PageIRNode {
	return {
		id: node.id,
		type: node.type,
		props: cloneValue(node.props, rewriteMap) as Readonly<
			Record<string, unknown>
		>,
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
