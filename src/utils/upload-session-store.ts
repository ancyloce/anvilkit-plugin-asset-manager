/**
 * @file Built-in {@link UploadSessionStore} implementation (PRD 0004 §5.1 — M2).
 *
 * Persists in-progress resumable-upload sessions so an interrupted upload can
 * resume after a reload. Keyed by a stable file fingerprint (name + size +
 * lastModified): the same picked file resumes, a different file does not.
 *
 * Backed by `localStorage` by default with a silent in-memory fallback when the
 * Web Storage API is unavailable or throws (SSR, Node tests, privacy mode).
 * Every storage call is wrapped — persistence is an *optimization*, never a
 * correctness dependency, so quota/availability errors degrade to "no resume"
 * rather than failing the upload.
 *
 * The interface ({@link UploadSessionStore}) lives in `types/resumable.ts`
 * alongside the rest of the contract; this module is the implementation only,
 * so `types → utils` never forms an import cycle.
 *
 * @experimental Public surface may change before v1.0.
 */

import type {
	PersistedUploadSession,
	UploadSessionStore,
} from "../types/resumable.js";

/**
 * Minimal subset of the Web Storage API the session store relies on. Declared
 * locally (rather than referencing the DOM `Storage` lib type) so a host can
 * supply `sessionStorage`, a namespaced wrapper, or a test double without
 * pulling in DOM typings.
 */
export interface UploadSessionStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

/** Options for {@link createUploadSessionStore}. */
export interface CreateUploadSessionStoreOptions {
	/**
	 * Backing storage. Defaults to `globalThis.localStorage` when usable,
	 * otherwise a process-lifetime in-memory map.
	 */
	readonly storage?: UploadSessionStorage;
	/** Key namespace. Defaults to `"anvilkit:asset-upload"`. */
	readonly keyPrefix?: string;
}

const DEFAULT_KEY_PREFIX = "anvilkit:asset-upload";

/**
 * Stable identity for an upload across reloads: the same file (by name, byte
 * length, and last-modified time) maps to the same key, while any edit changes
 * it. `name` is percent-encoded so the `:` delimiter can't be spoofed by a
 * filename.
 */
export function fingerprintFile(file: File): string {
	return `${encodeURIComponent(file.name)}:${file.size}:${file.lastModified}`;
}

/**
 * Create the built-in {@link UploadSessionStore}. Synchronous (localStorage is
 * synchronous); the contract's optionally-async return types let custom hosts
 * back it with IndexedDB or a remote service.
 */
export function createUploadSessionStore(
	options: CreateUploadSessionStoreOptions = {},
): UploadSessionStore {
	const storage = options.storage ?? resolveDefaultStorage();
	const prefix = options.keyPrefix ?? DEFAULT_KEY_PREFIX;
	const keyOf = (file: File): string => `${prefix}:${fingerprintFile(file)}`;

	return {
		load(file) {
			const key = keyOf(file);
			let raw: string | null;
			try {
				raw = storage.getItem(key);
			} catch {
				return undefined;
			}
			if (raw === null) return undefined;

			let parsed: unknown;
			try {
				parsed = JSON.parse(raw);
			} catch {
				dropQuietly(storage, key);
				return undefined;
			}
			if (!isPersistedUploadSession(parsed)) {
				dropQuietly(storage, key);
				return undefined;
			}
			return parsed;
		},

		save(file, session) {
			// Serialize OUTSIDE the try: a `JSON.stringify` failure (cyclic data,
			// `BigInt`) is a caller/adapter contract violation — the session meta
			// is typed JSON-safe — and should surface, not be silently dropped.
			// Only the storage write is best-effort (quota / private mode).
			const serialized = JSON.stringify(session);
			try {
				storage.setItem(keyOf(file), serialized);
			} catch {
				// Quota or availability error — resume is best-effort, so swallow.
			}
		},

		clear(file) {
			dropQuietly(storage, keyOf(file));
		},
	};
}

function dropQuietly(storage: UploadSessionStorage, key: string): void {
	try {
		storage.removeItem(key);
	} catch {
		// ignore — nothing actionable if removal fails
	}
}

/**
 * Prefer `localStorage`, but probe it first: in private-browsing modes and some
 * embedded webviews the object exists yet throws on write. Any failure (or its
 * absence under SSR / Node) falls back to an in-memory store.
 */
function resolveDefaultStorage(): UploadSessionStorage {
	try {
		const ls = (globalThis as { localStorage?: UploadSessionStorage })
			.localStorage;
		if (ls) {
			const probe = `${DEFAULT_KEY_PREFIX}:__probe__`;
			ls.setItem(probe, "1");
			ls.removeItem(probe);
			return ls;
		}
	} catch {
		// fall through to in-memory
	}
	return createMemoryStorage();
}

function createMemoryStorage(): UploadSessionStorage {
	const map = new Map<string, string>();
	return {
		getItem: (key) => map.get(key) ?? null,
		setItem: (key, value) => {
			map.set(key, value);
		},
		removeItem: (key) => {
			map.delete(key);
		},
	};
}

function isPersistedUploadSession(
	value: unknown,
): value is PersistedUploadSession {
	if (!isJsonObject(value)) return false;
	const v = value as Record<string, unknown>;
	if (typeof v.uploadId !== "string" || v.uploadId === "") return false;
	// `partSize` drives slicing and which `partNumber`s are skipped on resume —
	// a 0/negative/fractional value would corrupt byte ranges, so require a
	// positive safe integer.
	if (!isPositiveSafeInteger(v.partSize)) return false;
	if (v.meta !== undefined && !isJsonObject(v.meta)) return false;
	if (!Array.isArray(v.parts)) return false;
	return v.parts.every(
		(part) =>
			isJsonObject(part) &&
			isPositiveSafeInteger((part as { partNumber?: unknown }).partNumber) &&
			typeof (part as { etag?: unknown }).etag === "string",
	);
}

/**
 * A non-null, non-array object. The persisted blob came from `JSON.parse`, so
 * its leaves are already JSON-safe by construction (no functions, symbols, or
 * `BigInt` survive a round-trip) — only the top-level shape needs guarding, not
 * a recursive walk.
 */
function isJsonObject(value: unknown): boolean {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPositiveSafeInteger(value: unknown): boolean {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
