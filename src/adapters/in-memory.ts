import type { UploadAdapter, UploadResult } from "../types/types.js";
import { extractImageDimensions } from "./extract-image-dimensions.js";

/**
 * In-memory upload adapter for demos and tests. Returns a `blob:` URL
 * that the consumer renders directly, so the object URL intentionally
 * lives for the page lifetime — it cannot be revoked while the asset is
 * still referenced.
 *
 * Lifecycle caveat (C4): this is a stateless factory with no delete hook, so a
 * `blob:` URL is never `URL.revokeObjectURL`-d — including when its asset is
 * removed from the registry. Each upload pins its `File` in memory until the
 * page unloads, so a long session that churns through many upload/delete cycles
 * leaks. Acceptable for its dev/test purpose; use a real backend (e.g.
 * `s3PresignedAdapter`) in production.
 */
export function inMemoryUploader(): UploadAdapter {
	let counter = 0;

	return async (file, opts) => {
		counter += 1;
		const id = `asset-${counter}`;

		const url =
			typeof URL.createObjectURL === "function"
				? URL.createObjectURL(file)
				: `blob:asset-manager/${id}`;

		const dimensions = await extractImageDimensions(url, file.type, {
			...(opts?.signal ? { signal: opts.signal } : {}),
		});

		const result: UploadResult = {
			id,
			url,
			meta: {
				size: file.size,
				...(file.type ? { mimeType: file.type } : {}),
				...(dimensions
					? { width: dimensions.width, height: dimensions.height }
					: {}),
			},
		};

		return result;
	};
}
