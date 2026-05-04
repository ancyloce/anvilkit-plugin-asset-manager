import type {
	AssetRegistry,
	AssetRegistryListener,
	UploadResult,
} from "./types.js";

export function createAssetRegistry(): AssetRegistry {
	const assetsById = new Map<string, UploadResult>();
	const listeners = new Set<AssetRegistryListener>();

	const notify = (): void => {
		for (const listener of listeners) {
			listener();
		}
	};

	return {
		register(asset) {
			const stored = freezeUploadResult(asset);
			assetsById.set(stored.id, stored);
			notify();
			return stored;
		},
		get(id) {
			return assetsById.get(id);
		},
		list() {
			return Object.freeze([...assetsById.values()]);
		},
		delete(id) {
			const removed = assetsById.delete(id);
			if (removed) {
				notify();
			}
			return removed;
		},
		rename(id, name) {
			const current = assetsById.get(id);
			if (current === undefined) {
				return undefined;
			}
			const trimmed = name.trim();
			const next = freezeUploadResult({
				...current,
				...(trimmed === "" ? {} : { name: trimmed }),
			});
			assetsById.set(id, next);
			notify();
			return next;
		},
		replace(id, next) {
			if (!assetsById.has(id)) {
				return undefined;
			}
			const merged = freezeUploadResult({ ...next, id });
			assetsById.set(id, merged);
			notify();
			return merged;
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}

function freezeUploadResult(asset: UploadResult): UploadResult {
	const nextAsset: UploadResult = {
		id: asset.id,
		url: asset.url,
		...(asset.name !== undefined ? { name: asset.name } : {}),
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
