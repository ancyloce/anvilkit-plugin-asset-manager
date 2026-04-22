import type { UploadAdapter, UploadResult } from "../types.js";

export function inMemoryUploader(): UploadAdapter {
	const filesById = new Map<string, File>();
	let counter = 0;

	return async (file) => {
		counter += 1;
		const id = `asset-${counter}`;
		filesById.set(id, file);

		const url =
			typeof URL.createObjectURL === "function"
				? URL.createObjectURL(file)
				: `blob:asset-manager/${id}`;

		const result: UploadResult = {
			id,
			url,
			meta: {
				size: file.size,
				...(file.type ? { mimeType: file.type } : {}),
			},
		};

		return result;
	};
}
