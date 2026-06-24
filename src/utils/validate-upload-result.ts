import type { AssetManagerOptions } from "../types/options.js";
import type { UploadResult } from "../types/types.js";
import { AssetValidationError } from "./errors.js";

const ALWAYS_ALLOWED_SCHEMES = new Set(["http", "https", "blob"]);
const HARD_BLOCKED_SCHEMES = new Set(["javascript", "vbscript"]);

/**
 * Subset of {@link AssetManagerOptions} consulted by the trust boundary.
 * `urlAllowlist` is intentionally absent — Phase 4 replaced the raw
 * allowlist with the two typed flags below.
 */
export type ValidateUploadResultOptions = Pick<
	AssetManagerOptions,
	"dataUrlAllowlistOptIn" | "allowMixedScriptHostnames"
>;

/** Validate and sanitize an upload adapter result before registry insertion. */
export function validateUploadResult(
	result: UploadResult,
	options: ValidateUploadResultOptions = {},
): UploadResult {
	if (typeof result.id !== "string" || result.id.trim() === "") {
		throw new AssetValidationError(
			"INVALID_UPLOAD_ID",
			"Upload adapter returned an empty asset id.",
		);
	}

	const normalizedUrl = normalizeAllowedUrl(result.url, options);
	const trimmedName = typeof result.name === "string" ? result.name.trim() : "";
	const nextResult: UploadResult = {
		id: result.id.trim(),
		url: normalizedUrl,
		...(trimmedName !== "" ? { name: trimmedName } : {}),
		...(result.meta ? { meta: stripUndefinedMeta(result.meta) } : {}),
		...(result.tags && result.tags.length > 0
			? { tags: Object.freeze([...result.tags]) }
			: {}),
	};

	return Object.freeze(nextResult);
}

function normalizeAllowedUrl(
	input: string,
	options: ValidateUploadResultOptions,
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

	const sanitized = stripUnsafeAscii(candidate);
	const schemeMatch = sanitized.match(/^([a-z][a-z0-9+.-]*):/i);
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

	if (!isSchemeAllowed(scheme, options)) {
		throw new AssetValidationError(
			"DISALLOWED_UPLOAD_URL_SCHEME",
			`Upload adapter returned URL scheme "${scheme}" which is not in the allowlist.`,
		);
	}

	if (scheme === "http" || scheme === "https" || scheme === "blob") {
		assertNoPathTraversal(sanitized);
	}

	if (scheme === "http" || scheme === "https") {
		assertNoMixedScriptHostname(sanitized, options);
	}

	return sanitized;
}

function isSchemeAllowed(
	scheme: string,
	options: ValidateUploadResultOptions,
): boolean {
	if (ALWAYS_ALLOWED_SCHEMES.has(scheme)) {
		return true;
	}
	if (scheme === "data") {
		return options.dataUrlAllowlistOptIn === true;
	}
	return false;
}

/**
 * Reject `../` path-traversal — both literal and percent-encoded
 * (`%2e%2e/`, `%2e%2e%2f`, mixed-case variants). Applied to
 * `http`/`https`/`blob` because those are the schemes whose pathnames
 * are interpreted relative to a host filesystem or origin.
 */
function assertNoPathTraversal(url: string): void {
	const lowered = url.toLowerCase();
	if (lowered.includes("../") || lowered.includes("..%2f")) {
		throw new AssetValidationError(
			"PATH_TRAVERSAL_URL",
			"Upload adapter returned a URL containing path-traversal segments.",
		);
	}
	if (lowered.includes("%2e%2e/") || lowered.includes("%2e%2e%2f")) {
		throw new AssetValidationError(
			"PATH_TRAVERSAL_URL",
			"Upload adapter returned a URL containing percent-encoded path-traversal segments.",
		);
	}
}

/**
 * Reject hostnames that mix Latin with a visually confusable script
 * (Cyrillic or Greek) — the classic homoglyph vector, e.g. Cyrillic
 * `а` blended with Latin letters in `аpple.com`. Pure single-script
 * IDN hosts (`münchen.de`, `日本.jp`, `россия.рф`) are allowed because
 * the visible characters cannot be confused with Latin letters.
 *
 * Note: `.jp` / `.de` / `.com` etc. are always Latin TLDs, so a Han
 * or Cyrillic SLD legitimately co-exists with Latin in the same
 * hostname. The guard only fires when Latin and a *confusable* script
 * appear together.
 *
 * Hosts that legitimately need this combination can opt in via
 * `allowMixedScriptHostnames: true`.
 */
function assertNoMixedScriptHostname(
	url: string,
	options: ValidateUploadResultOptions,
): void {
	if (options.allowMixedScriptHostnames === true) {
		return;
	}

	// Extract the hostname from the *raw* URL string rather than via
	// `new URL().hostname`, which Punycode-encodes IDN hosts to ASCII
	// (`xn--…`) and erases the script-mixing signal we are checking
	// for. The regex covers `scheme://[user@]host[:port]…` — anything
	// before the first port colon, path slash, query, or fragment is
	// the host.
	const match = url.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^:/?#]+)/i);
	if (!match) return;
	const hostname = match[1] ?? "";
	if (hostname === "") return;

	const scripts = detectHostnameScripts(hostname);
	const hasLatin = scripts.has("Latin");
	const confusable = ["Cyrillic", "Greek"].filter((s) => scripts.has(s));
	if (hasLatin && confusable.length > 0) {
		throw new AssetValidationError(
			"MIXED_SCRIPT_HOSTNAME",
			`Upload adapter returned a URL whose hostname mixes Latin with a visually confusable script (${confusable.join(
				", ",
			)}). Set allowMixedScriptHostnames: true to permit this.`,
		);
	}
}

// Unicode-property regexes are expensive to construct; compile them once
// at module load instead of per-character inside the scan loop.
const SKIP_SCRIPT_RE = /[\p{Script=Common}\p{Script=Inherited}]/u;
const SCRIPT_MATCHERS: readonly (readonly [string, RegExp])[] = [
	["Latin", /\p{Script=Latin}/u],
	["Cyrillic", /\p{Script=Cyrillic}/u],
	["Greek", /\p{Script=Greek}/u],
	["Han", /\p{Script=Han}/u],
	["Hiragana", /\p{Script=Hiragana}/u],
	["Katakana", /\p{Script=Katakana}/u],
	["Hangul", /\p{Script=Hangul}/u],
	["Arabic", /\p{Script=Arabic}/u],
	["Hebrew", /\p{Script=Hebrew}/u],
];

function detectHostnameScripts(host: string): Set<string> {
	const scripts = new Set<string>();
	// Scan the full hostname — truncating before the script check would
	// let an attacker pad with one script and hide a confusable char past
	// the cap (fail-open bypass). The hoisted regexes above already remove
	// the per-character recompilation cost that motivated bounding this.
	for (const ch of host) {
		// Common (digits, ".", "-", ":") and Inherited categories carry
		// no script signal — skip them so a normal IPv4 / DNS label
		// doesn't register as its own script.
		if (SKIP_SCRIPT_RE.test(ch)) continue;
		let matched = false;
		for (const [name, re] of SCRIPT_MATCHERS) {
			if (re.test(ch)) {
				scripts.add(name);
				matched = true;
				break;
			}
		}
		if (!matched) scripts.add("Other");
	}
	return scripts;
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
		...(meta.hash !== undefined ? { hash: meta.hash } : {}),
		...(meta.attribution !== undefined
			? { attribution: Object.freeze({ ...meta.attribution }) }
			: {}),
	};

	return Object.freeze(nextMeta);
}
