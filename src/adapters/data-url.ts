import type { UploadAdapter, UploadResult } from "../types/types.js";
import { AssetValidationError } from "../utils/errors.js";
import { extractImageDimensions } from "./extract-image-dimensions.js";

export interface DataUrlUploaderOptions {
	/**
	 * Maximum **raw file size** in bytes (default 1 MB). This bounds the input
	 * file, NOT the emitted `data:` URL: base64 encoding inflates the payload
	 * ~4/3, so a file at the cap becomes a ~1.33× larger string that is held in
	 * memory and embedded inline in the registry / IR / exported page (C3). Size
	 * the cap for the *encoded* footprint your target can carry.
	 */
	readonly maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 1_048_576;

/**
 * Dev/demo upload adapter that inlines the file as a `data:` URL. The result is
 * self-contained (no host backend) but ~33% larger than the raw bytes once
 * base64-encoded — see {@link DataUrlUploaderOptions.maxBytes}. Not for
 * production; use `s3PresignedAdapter` or a custom `UploadAdapter` there.
 */
export function dataUrlUploader(
	options: DataUrlUploaderOptions = {},
): UploadAdapter {
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
	let counter = 0;

	return async (file, opts) => {
		if (file.size > maxBytes) {
			throw new AssetValidationError(
				"DATA_URL_FILE_TOO_LARGE",
				`File size ${file.size} bytes exceeds the data URL adapter limit of ${maxBytes} bytes.`,
			);
		}

		counter += 1;
		const url = await readAsDataUrl(file);
		const dimensions = await extractImageDimensions(url, file.type, {
			...(opts?.signal ? { signal: opts.signal } : {}),
		});
		const result: UploadResult = {
			id: `asset-${counter}`,
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

function readAsDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () => {
			reject(
				new AssetValidationError(
					"DATA_URL_READ_FAILED",
					"Failed to read file as a data URL.",
					{ cause: reader.error },
				),
			);
		};
		reader.onload = () => {
			if (typeof reader.result !== "string") {
				reject(
					new AssetValidationError(
						"DATA_URL_READ_FAILED",
						"FileReader did not produce a string data URL.",
					),
				);
				return;
			}

			resolve(reader.result);
		};
		reader.readAsDataURL(file);
	});
}
