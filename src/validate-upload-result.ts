import { AssetValidationError } from "./errors.js";
import type { AssetManagerOptions, UploadResult } from "./types.js";

const DEFAULT_URL_ALLOWLIST = ["http", "https", "blob"] as const;
const HARD_BLOCKED_SCHEMES = new Set(["javascript", "vbscript"]);

export function validateUploadResult(
	result: UploadResult,
	options: Pick<AssetManagerOptions, "urlAllowlist"> = {},
): UploadResult {
	if (typeof result.id !== "string" || result.id.trim() === "") {
		throw new AssetValidationError(
			"INVALID_UPLOAD_ID",
			"Upload adapter returned an empty asset id.",
		);
	}

	const normalizedUrl = normalizeAllowedUrl(result.url, options.urlAllowlist);
	const nextResult: UploadResult = {
		id: result.id.trim(),
		url: normalizedUrl,
		...(result.meta ? { meta: stripUndefinedMeta(result.meta) } : {}),
	};

	return Object.freeze(nextResult);
}

function normalizeAllowedUrl(
	input: string,
	allowlist: readonly string[] | undefined,
): string {
	const candidate = normalizeCandidate(input);
	if (!candidate) {
		throw new AssetValidationError(
			"EMPTY_UPLOAD_URL",
			"Upload adapter returned an empty URL.",
		);
	}

	if (candidate.startsWith("//")) {
		throw new AssetValidationError(
			"UNSCHEMED_UPLOAD_URL",
			"Upload adapter returned a scheme-less URL. Use an absolute URL with an allowed scheme.",
		);
	}

	const collapsed = stripUnsafeAscii(candidate).toLowerCase();
	const schemeMatch = collapsed.match(/^([a-z][a-z0-9+.-]*):/i);
	if (!schemeMatch) {
		throw new AssetValidationError(
			"UNSCHEMED_UPLOAD_URL",
			"Upload adapter returned a URL without a scheme.",
		);
	}

	const scheme = schemeMatch[1]?.toLowerCase();
	if (!scheme) {
		throw new AssetValidationError(
			"UNSCHEMED_UPLOAD_URL",
			"Upload adapter returned a URL without a scheme.",
		);
	}

	if (HARD_BLOCKED_SCHEMES.has(scheme)) {
		throw new AssetValidationError(
			"DISALLOWED_UPLOAD_URL_SCHEME",
			`Upload adapter returned a disallowed URL scheme "${scheme}".`,
		);
	}

	const allowedSchemes = new Set(
		(allowlist ?? DEFAULT_URL_ALLOWLIST).map((entry) => entry.toLowerCase()),
	);
	if (!allowedSchemes.has(scheme)) {
		throw new AssetValidationError(
			"DISALLOWED_UPLOAD_URL_SCHEME",
			`Upload adapter returned URL scheme "${scheme}" which is not in the allowlist.`,
		);
	}

	return candidate;
}

function normalizeCandidate(input: string): string | undefined {
	const candidate = input.trim();
	return candidate === "" ? undefined : candidate;
}

function stripUnsafeAscii(input: string): string {
	let output = "";

	for (const character of input) {
		const codePoint = character.charCodeAt(0);
		if (codePoint <= 0x20 || codePoint === 0x7f) {
			continue;
		}

		output += character;
	}

	return output;
}

function stripUndefinedMeta(meta: UploadResult["meta"]) {
	if (!meta) {
		return undefined;
	}

	const nextMeta = {
		...(meta.size !== undefined ? { size: meta.size } : {}),
		...(meta.mimeType !== undefined ? { mimeType: meta.mimeType } : {}),
		...(meta.width !== undefined ? { width: meta.width } : {}),
		...(meta.height !== undefined ? { height: meta.height } : {}),
	};

	return Object.freeze(nextMeta);
}
