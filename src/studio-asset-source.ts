/**
 * @file `StudioAssetSource` adapter — bridges the asset-manager
 * registry into the sidebar's `image` module.
 *
 * The sidebar reads through `ctx.registerAssetSource(source)`. This
 * file shapes the registry's `UploadResult` rows into the `StudioAsset`
 * shape the sidebar consumes, threads the upload pipeline through
 * `uploadAsset()`, and notifies subscribers on every mutation.
 *
 * The adapter does not own state — it is a thin projection over the
 * shared `AssetRegistry`. Mutation methods route back through the
 * registry so the IR resolver and the sidebar see the same data.
 */

import type {
	StudioAsset,
	StudioAssetKind,
	StudioAssetSource,
	StudioAssetUploadListener,
} from "@anvilkit/core/types";

import { createAssetReference } from "./asset-reference.js";
import type { AssetRegistry, UploadResult } from "./types.js";

export interface CreateStudioAssetSourceOptions {
	readonly registry: AssetRegistry;
	/**
	 * Performs the upload. Provided by the plugin so the adapter does
	 * not need to depend on `StudioPluginContext` directly.
	 */
	readonly upload: (file: File) => Promise<UploadResult>;
}

export function createStudioAssetSource(
	options: CreateStudioAssetSourceOptions,
): StudioAssetSource {
	const { registry, upload } = options;

	return {
		list() {
			return registry.list().map(toStudioAsset);
		},

		async upload(files, listener) {
			const uploaded: StudioAsset[] = [];
			let totalBytes = 0;
			for (const file of files) {
				totalBytes += file.size;
			}
			let bytesUploaded = 0;
			for (const file of files) {
				try {
					const result = await upload(file);
					bytesUploaded += file.size;
					const asset = toStudioAsset(result);
					uploaded.push(asset);
					emitProgress(listener, bytesUploaded, totalBytes);
					emitDone(listener, asset);
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					emitError(listener, message);
					throw error;
				}
			}
			return uploaded;
		},

		delete(assetId) {
			registry.delete(assetId);
			return Promise.resolve();
		},

		rename(assetId, nextName) {
			registry.rename(assetId, nextName);
			return Promise.resolve();
		},

		async replace(assetId, file) {
			const result = await upload(file);
			const replaced = registry.replace(assetId, result);
			if (replaced === undefined) {
				// The id no longer exists — fall back to the freshly-uploaded
				// entry so the caller still sees a valid asset.
				return toStudioAsset(result);
			}
			return toStudioAsset(replaced);
		},

		getUrl(assetId) {
			return createAssetReference(assetId);
		},

		subscribe(listener) {
			return registry.subscribe(listener);
		},
	};
}

function toStudioAsset(entry: UploadResult): StudioAsset {
	const kind = inferStudioAssetKind(entry);
	const url = createAssetReference(entry.id);
	const name = entry.name ?? deriveFallbackName(entry);
	const studioAsset: StudioAsset = {
		id: entry.id,
		kind,
		name,
		url,
		...(entry.meta?.mimeType !== undefined
			? { mimeType: entry.meta.mimeType }
			: {}),
		...(entry.meta?.size !== undefined ? { size: entry.meta.size } : {}),
	};

	return studioAsset;
}

export function inferStudioAssetKind(entry: UploadResult): StudioAssetKind {
	const mimeType = entry.meta?.mimeType;
	if (mimeType?.startsWith("image/")) return "image";
	if (mimeType?.startsWith("video/")) return "video";
	if (mimeType?.startsWith("audio/")) return "audio";
	return "other";
}

function deriveFallbackName(entry: UploadResult): string {
	const tail = entry.url.split(/[/?#]/).filter(Boolean).pop();
	if (tail !== undefined && tail !== "" && !tail.startsWith("data:")) {
		return tail;
	}
	const idTail = entry.id.length > 12 ? `${entry.id.slice(0, 8)}…` : entry.id;
	return `Asset ${idTail}`;
}

function emitProgress(
	listener: StudioAssetUploadListener | undefined,
	bytesUploaded: number,
	bytesTotal: number,
): void {
	listener?.({ type: "progress", bytesUploaded, bytesTotal });
}

function emitDone(
	listener: StudioAssetUploadListener | undefined,
	asset: StudioAsset,
): void {
	listener?.({ type: "done", asset });
}

function emitError(
	listener: StudioAssetUploadListener | undefined,
	message: string,
): void {
	listener?.({ type: "error", message });
}
