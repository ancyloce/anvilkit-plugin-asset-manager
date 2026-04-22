import type { AssetRegistry, UploadResult } from "./types.js";

export function createAssetRegistry(): AssetRegistry {
	const assetsById = new Map<string, UploadResult>();

	return {
		register(asset) {
			const stored = freezeUploadResult(asset);
			assetsById.set(stored.id, stored);
			return stored;
		},
		get(id) {
			return assetsById.get(id);
		},
		list() {
			return Object.freeze([...assetsById.values()]);
		},
	};
}

function freezeUploadResult(asset: UploadResult): UploadResult {
	const nextAsset: UploadResult = {
		id: asset.id,
		url: asset.url,
		...(asset.meta
			? {
					meta: Object.freeze({
						...(asset.meta.size !== undefined ? { size: asset.meta.size } : {}),
						...(asset.meta.mimeType !== undefined
							? { mimeType: asset.meta.mimeType }
							: {}),
						...(asset.meta.width !== undefined
							? { width: asset.meta.width }
							: {}),
						...(asset.meta.height !== undefined
							? { height: asset.meta.height }
							: {}),
					}),
				}
			: {}),
	};

	return Object.freeze(nextAsset);
}
