import type { UploadAdapter, UploadResult } from "../types.js";
import { extractImageDimensions } from "./extract-image-dimensions.js";

/**
 * In-memory upload adapter for demos and tests. Returns a `blob:` URL
 * that the consumer renders directly, so the object URL intentionally
 * lives for the page lifetime — it cannot be revoked while the asset is
 * still referenced. Not for production use.
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
