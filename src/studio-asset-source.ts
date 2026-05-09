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

/**
 * Default concurrency cap for batched uploads. Editors typically drag
 * 1–10 files at a time; three concurrent uploads strikes a balance
 * between throughput and politeness to host endpoints.
 */
export const MAX_CONCURRENT_UPLOADS = 3;

export interface CreateStudioAssetSourceOptions {
	readonly registry: AssetRegistry;
	/**
	 * Performs the upload. Provided by the plugin so the adapter does
	 * not need to depend on `StudioPluginContext` directly.
	 */
	readonly upload: (file: File) => Promise<UploadResult>;
	/**
	 * Optional thumbnail derivation. Returning a string sets
	 * `StudioAsset.thumbnailUrl`; returning `undefined` suppresses the
	 * thumbnail (overriding the default-for-images behavior).
	 *
	 * When omitted, image-kind assets get the original URL as their
	 * thumbnail and other kinds get no thumbnail.
	 */
	readonly getThumbnail?: (entry: UploadResult) => string | undefined;
	/**
	 * Maximum number of uploads in flight. Defaults to
	 * `MAX_CONCURRENT_UPLOADS` (3). Set to 1 to restore the previous
	 * sequential behavior.
	 */
	readonly maxConcurrentUploads?: number;
}

export function createStudioAssetSource(
	options: CreateStudioAssetSourceOptions,
): StudioAssetSource {
	const { registry, upload, getThumbnail } = options;
	const maxConcurrent = Math.max(
		1,
		options.maxConcurrentUploads ?? MAX_CONCURRENT_UPLOADS,
	);

	const project = (entry: UploadResult): StudioAsset =>
		toStudioAsset(entry, getThumbnail);

	return {
		list() {
			return registry.list().map(project);
		},

		async upload(files, listener) {
			const fileList = Array.from(files);
			if (fileList.length === 0) {
				return [];
			}

			const totalBytes = fileList.reduce((acc, file) => acc + file.size, 0);
			let bytesUploaded = 0;
			const results: Array<StudioAsset | null> = new Array(
				fileList.length,
			).fill(null);
			let nextIndex = 0;
			let abortError: unknown = undefined;

			const runWorker = async (): Promise<void> => {
				while (true) {
					if (abortError !== undefined) {
						return;
					}
					const index = nextIndex++;
					if (index >= fileList.length) {
						return;
					}
					const file = fileList[index];
					if (file === undefined) {
						return;
					}
					try {
						const result = await upload(file);
						bytesUploaded += file.size;
						const asset = project(result);
						results[index] = asset;
						emitProgress(listener, bytesUploaded, totalBytes);
						emitDone(listener, asset);
					} catch (error) {
						if (isAbortError(error)) {
							abortError = error;
							return;
						}
						const message =
							error instanceof Error ? error.message : String(error);
						emitError(listener, message);
						// Per-file failure does not abort the batch; continue.
					}
				}
			};

			const workerCount = Math.min(maxConcurrent, fileList.length);
			const workers: Promise<void>[] = [];
			for (let i = 0; i < workerCount; i += 1) {
				workers.push(runWorker());
			}
			await Promise.all(workers);

			if (abortError !== undefined) {
				throw abortError;
			}

			return results.filter((value): value is StudioAsset => value !== null);
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
				return project(result);
			}
			return project(replaced);
		},

		getUrl(assetId) {
			return createAssetReference(assetId);
		},

		subscribe(listener) {
			return registry.subscribe(listener);
		},
	};
}

function toStudioAsset(
	entry: UploadResult,
	getThumbnail?: (entry: UploadResult) => string | undefined,
): StudioAsset {
	const kind = inferStudioAssetKind(entry);
	const url = createAssetReference(entry.id);
	const name = entry.name ?? deriveFallbackName(entry);
	const thumbnailUrl = deriveThumbnailUrl(entry, kind, getThumbnail);
	const studioAsset: StudioAsset = {
		id: entry.id,
		kind,
		name,
		url,
		...(thumbnailUrl !== undefined ? { thumbnailUrl } : {}),
		...(entry.meta?.mimeType !== undefined
			? { mimeType: entry.meta.mimeType }
			: {}),
		...(entry.meta?.size !== undefined ? { size: entry.meta.size } : {}),
	};

	return studioAsset;
}

export function inferStudioAssetKind(entry: UploadResult): StudioAssetKind {
	const mimeType = entry.meta?.mimeType;
	const url = entry.url;
	if (mimeType?.startsWith("image/")) return "image";
	if (mimeType?.startsWith("video/")) return "video";
	if (mimeType?.startsWith("audio/")) return "audio";
	if (
		mimeType?.startsWith("font/") ||
		/\.(?:woff2?|ttf|otf)(?:$|[?#])/i.test(url)
	) {
		return "font";
	}
	if (mimeType === "application/pdf" || /\.pdf(?:$|[?#])/i.test(url)) {
		return "document";
	}
	return "other";
}

function deriveThumbnailUrl(
	entry: UploadResult,
	kind: StudioAssetKind,
	getThumbnail: ((entry: UploadResult) => string | undefined) | undefined,
): string | undefined {
	if (getThumbnail !== undefined) {
		return getThumbnail(entry);
	}
	return kind === "image" ? entry.url : undefined;
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

function isAbortError(error: unknown): boolean {
	if (error === null || typeof error !== "object") {
		return false;
	}
	const name = (error as { name?: unknown }).name;
	return name === "AbortError";
}
