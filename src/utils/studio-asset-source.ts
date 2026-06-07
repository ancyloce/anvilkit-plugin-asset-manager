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
	StudioAssetListPage,
	StudioAssetListQuery,
	StudioAssetSource,
	StudioAssetUploadEvent,
	StudioAssetUploadListener,
} from "@anvilkit/core/types";
import type {
	AssetRegistry,
	UploadAdapterOptions,
	UploadResult,
} from "../types/types.js";
import { createAssetReference } from "./asset-reference.js";
import { inferAssetKind } from "./infer-kind.js";

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
	readonly upload: (
		file: File,
		options?: UploadAdapterOptions,
	) => Promise<UploadResult>;
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

	const uploadListeners = new Set<StudioAssetUploadListener>();
	const fanOut = (event: StudioAssetUploadEvent): void => {
		for (const subscriber of uploadListeners) {
			safeNotify(subscriber, event);
		}
	};

	return {
		list() {
			return registry.list().map(project);
		},

		listPaginated(query) {
			const page = registry.search({
				...(query.query !== undefined ? { query: query.query } : {}),
				...(query.kinds ? { kinds: query.kinds } : {}),
				...(query.tags ? { tags: query.tags } : {}),
				...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
				...(query.limit !== undefined ? { limit: query.limit } : {}),
			});
			const projected: StudioAssetListPage = {
				items: Object.freeze(page.items.map(project)),
				total: page.total,
				nextCursor: page.nextCursor,
			};
			return Promise.resolve(projected);
		},

		async upload(files, listener, signal) {
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

			const emit = (event: StudioAssetUploadEvent): void => {
				safeNotify(listener, event);
				fanOut(event);
			};

			const abortFromSignal = (): void => {
				if (abortError === undefined) {
					abortError =
						signal?.reason instanceof Error ? signal.reason : makeAbortError();
				}
			};
			if (signal?.aborted) {
				abortFromSignal();
			}
			signal?.addEventListener("abort", abortFromSignal, { once: true });

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
						const result = await upload(file, { signal });
						// Another worker aborted while this upload was in
						// flight — drop the result instead of emitting a
						// `done`/`progress` event for a batch that will reject.
						if (abortError !== undefined) {
							return;
						}
						bytesUploaded += file.size;
						const asset = project(result);
						results[index] = asset;
						emit({
							type: "progress",
							bytesUploaded,
							bytesTotal: totalBytes,
						});
						emit({ type: "done", asset });
					} catch (error) {
						if (isAbortError(error)) {
							abortError = error;
							return;
						}
						// If the batch is already aborting, drop this per-file
						// failure instead of fanning a noisy `error` event out
						// to inline listeners / `subscribeUploads` subscribers —
						// the eventual batch rejection is the authoritative
						// outcome for a cancelled run.
						if (abortError !== undefined || signal?.aborted) {
							return;
						}
						const message =
							error instanceof Error ? error.message : String(error);
						emit({ type: "error", message });
						// Per-file failure does not abort the batch; continue.
					}
				}
			};

			const workerCount = Math.min(maxConcurrent, fileList.length);
			const workers: Promise<void>[] = [];
			for (let i = 0; i < workerCount; i += 1) {
				workers.push(runWorker());
			}
			try {
				await Promise.all(workers);

				if (abortError !== undefined) {
					throw abortError;
				}

				return results.filter((value): value is StudioAsset => value !== null);
			} finally {
				// Always detach the bridge listener — a worker that throws
				// (e.g. a subscriber callback faulting in `emit`) would
				// otherwise leak the closure on a long-lived signal.
				signal?.removeEventListener("abort", abortFromSignal);
			}
		},

		delete(assetId) {
			registry.delete(assetId);
			return Promise.resolve();
		},

		rename(assetId, nextName) {
			registry.rename(assetId, nextName);
			return Promise.resolve();
		},

		setTags(assetId, tags) {
			registry.setTags(assetId, tags);
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

		subscribeUploads(listener) {
			uploadListeners.add(listener);
			return () => {
				uploadListeners.delete(listener);
			};
		},
	};
}

/**
 * Project a registry `UploadResult` into the sidebar's `StudioAsset` shape.
 * Exported so the composite source reuses the exact same projection.
 */
export function toStudioAsset(
	entry: UploadResult,
	getThumbnail?: (entry: UploadResult) => string | undefined,
): StudioAsset {
	const kind = inferAssetKind(entry);
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
		...(entry.tags && entry.tags.length > 0
			? { tags: Object.freeze([...entry.tags]) }
			: {}),
	};

	return studioAsset;
}

/**
 * Public alias for {@link inferAssetKind}. Preserved as the documented
 * Studio-side projection so existing imports keep working; library
 * search now uses the same logic via `infer-kind.ts`.
 */
export function inferStudioAssetKind(entry: UploadResult): StudioAssetKind {
	return inferAssetKind(entry);
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

/**
 * Deliver an upload event to one listener without letting a faulting subscriber
 * escape. A throwing `subscribeUploads` callback (or inline `upload` listener)
 * must NOT reject an otherwise-successful batch — the batch's resolved/aborted
 * result is the authoritative outcome (C1). Delivery errors are swallowed by
 * design; this seam is fire-and-forget notification, not control flow.
 */
function safeNotify(
	listener: StudioAssetUploadListener | undefined,
	event: StudioAssetUploadEvent,
): void {
	if (listener === undefined) {
		return;
	}
	try {
		listener(event);
	} catch {
		// Intentionally ignored — a misbehaving subscriber can't fail the batch.
	}
}

function isAbortError(error: unknown): boolean {
	if (error === null || typeof error !== "object") {
		return false;
	}
	const name = (error as { name?: unknown }).name;
	return name === "AbortError";
}

/** DOM `AbortError` when available, else a name-tagged `Error` (SSR/Node). */
function makeAbortError(): Error {
	if (typeof DOMException !== "undefined") {
		return new DOMException("Upload aborted", "AbortError");
	}
	const error = new Error("Upload aborted");
	error.name = "AbortError";
	return error;
}
