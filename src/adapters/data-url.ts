import { AssetValidationError } from "../errors.js";
import type { UploadAdapter, UploadResult } from "../types.js";

export interface DataUrlUploaderOptions {
	readonly maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 1_048_576;

export function dataUrlUploader(
	options: DataUrlUploaderOptions = {},
): UploadAdapter {
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
	let counter = 0;

	return async (file) => {
		if (file.size > maxBytes) {
			throw new AssetValidationError(
				"DATA_URL_FILE_TOO_LARGE",
				`File size ${file.size} bytes exceeds the data URL adapter limit of ${maxBytes} bytes.`,
			);
		}

		counter += 1;
		const url = await readAsDataUrl(file);
		const result: UploadResult = {
			id: `asset-${counter}`,
			url,
			meta: {
				size: file.size,
				...(file.type ? { mimeType: file.type } : {}),
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
