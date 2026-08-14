import type { AssetManagerOptions } from "../types/options.js";
import { AssetValidationError } from "./errors.js";

/** Validate a browser-selected file against the configured upload allowlists. */
export function validateSelectedFile(
	file: File,
	options: Pick<
		AssetManagerOptions,
		"acceptedFileExtensions" | "acceptedMimeTypes" | "maxFileSize"
	>,
): void {
	if (options.maxFileSize !== undefined && file.size > options.maxFileSize) {
		throw new AssetValidationError(
			"FILE_TOO_LARGE",
			`File size ${file.size} bytes exceeds the configured maxFileSize of ${options.maxFileSize} bytes.`,
		);
	}

	const acceptedMimeTypes = options.acceptedMimeTypes ?? [];
	const acceptedFileExtensions = options.acceptedFileExtensions ?? [];
	const hasMimeAllowlist = acceptedMimeTypes.length > 0;
	const hasExtensionAllowlist = acceptedFileExtensions.length > 0;

	if (
		hasMimeAllowlist &&
		file.type !== "" &&
		!mimeTypeMatches(file.type, acceptedMimeTypes)
	) {
		throw new AssetValidationError(
			"UNSUPPORTED_MIME_TYPE",
			`File MIME type "${file.type}" is not in acceptedMimeTypes.`,
		);
	}
	if (hasMimeAllowlist && file.type === "" && !hasExtensionAllowlist) {
		throw new AssetValidationError(
			"UNSUPPORTED_MIME_TYPE",
			'File MIME type "unknown" is not in acceptedMimeTypes.',
		);
	}
	if (
		hasExtensionAllowlist &&
		!fileExtensionMatches(file.name, acceptedFileExtensions)
	) {
		const extension = file.name.includes(".")
			? file.name.slice(file.name.lastIndexOf(".")).toLowerCase()
			: "unknown";
		throw new AssetValidationError(
			"UNSUPPORTED_FILE_EXTENSION",
			`File extension "${extension}" is not in acceptedFileExtensions.`,
		);
	}
}

function mimeTypeMatches(
	input: string,
	acceptedMimeTypes: readonly string[],
): boolean {
	if (input === "") {
		return false;
	}

	return acceptedMimeTypes.some((accepted) => {
		if (accepted.endsWith("/*")) {
			const prefix = accepted.slice(0, accepted.length - 1);
			return input.startsWith(prefix);
		}

		return input === accepted;
	});
}

function fileExtensionMatches(
	name: string,
	acceptedFileExtensions: readonly string[],
): boolean {
	const lowerName = name.toLowerCase();
	if (lowerName === "") {
		return false;
	}

	return acceptedFileExtensions.some((accepted) => {
		const trimmed = accepted.trim().toLowerCase();
		if (trimmed === "") {
			return false;
		}
		const extension = trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
		return lowerName.endsWith(extension);
	});
}
