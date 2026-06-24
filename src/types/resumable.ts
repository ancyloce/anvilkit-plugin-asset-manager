/**
 * @file Resumable / multipart upload contract (PRD 0004 §5.1 — "High #1").
 *
 * A session-based alternative to the single-shot {@link UploadAdapter}. A large
 * file is split into ordered parts; each part uploads independently and is
 * retried in isolation, and an interrupted upload can resume from the parts the
 * backend already accepted (the session store added in M2 persists those
 * acknowledgements). The final artifact is still a single {@link UploadResult}
 * that flows through `validateUploadResult()` before registry insertion — the
 * trust boundary is unchanged.
 *
 * Dependency-free by design: the built-in S3 implementation (M4) drives an
 * extended presign endpoint rather than bundling the AWS SDK, mirroring
 * `s3PresignedAdapter`. The runner (M3) is adapter-agnostic — it owns slicing,
 * per-part retry, progress, resume, and abort, and never assumes S3.
 *
 * @experimental Public surface may change before v1.0.
 */

import type {
	UploadAdapter,
	UploadAdapterOptions,
	UploadResult,
} from "./types.js";

/**
 * One contiguous chunk of the source file handed to
 * {@link ResumableUploadAdapter.uploadPart}.
 */
export interface UploadPart {
	/**
	 * 1-based part index — contiguous and ascending. S3 multipart numbers parts
	 * from 1, so the runner and adapters share that convention with no offset.
	 */
	readonly partNumber: number;
	/** Byte offset of this part within the source file. */
	readonly start: number;
	/** Exclusive end offset; `end - start === blob.size`. */
	readonly end: number;
	/** The chunk body — a `File.slice(start, end)` of the source. */
	readonly blob: Blob;
}

/**
 * Opaque acknowledgement of a successfully stored part. `etag` is the value the
 * backend requires at completion (S3 returns one per `UploadPart`); the runner
 * persists it so the part is skipped when a session resumes.
 */
export interface PartTag {
	readonly partNumber: number;
	readonly etag: string;
}

/**
 * Backend handle for an in-progress multipart upload, returned by
 * {@link ResumableUploadAdapter.begin}.
 *
 * `uploadId` is the backend's session id (e.g. S3 `UploadId`). A non-empty
 * `parts` marks a *resumed* session — the runner skips those part numbers
 * rather than re-uploading them. `meta` is host-opaque continuation data that
 * round-trips unchanged back to `uploadPart` / `complete` / `abort`.
 */
export interface UploadSession {
	readonly uploadId: string;
	/** Parts already accepted by the backend (empty/omitted for a fresh session). */
	readonly parts?: readonly PartTag[];
	/**
	 * Effective part size in bytes, **locked for the life of the session**. The
	 * runner slices every part at this size, so resuming MUST reuse the same
	 * value — otherwise a skipped `partNumber` would map to a different byte
	 * range and corrupt the object. A backend may dictate it here; otherwise the
	 * runner sets it from config and persists it (see {@link
	 * PersistedUploadSession.partSize}). Once parts have been uploaded it must
	 * not change.
	 */
	readonly partSize?: number;
	/**
	 * Host-opaque continuation data echoed back to subsequent calls. To support
	 * resume across a page reload it MUST be JSON / structured-clone safe — the
	 * M2 session store persists it via {@link PersistedUploadSession.meta}.
	 */
	readonly meta?: Readonly<Record<string, unknown>>;
}

/**
 * Any value that survives `JSON.stringify` → `JSON.parse` (and `structuredClone`)
 * unchanged. Used to type persisted continuation data so the M2 session store
 * can round-trip it through `localStorage` without silently dropping functions,
 * symbols, `BigInt`, class instances, or cyclic references.
 */
export type JsonValue =
	| string
	| number
	| boolean
	| null
	| readonly JsonValue[]
	| { readonly [key: string]: JsonValue };

/**
 * The serializable subset of an {@link UploadSession} that the M2 session store
 * persists so an interrupted upload can resume after a reload. The runner loads
 * it (keyed by file fingerprint) and hands it to
 * {@link ResumableUploadAdapter.begin} as the `resume` argument. MUST be JSON /
 * structured-clone safe end-to-end — it round-trips through `localStorage`.
 */
export interface PersistedUploadSession {
	/** Backend session id (e.g. S3 `UploadId`) to reconcile against. */
	readonly uploadId: string;
	/** The effective part size locked in when the session started (bytes). */
	readonly partSize: number;
	/** Parts the backend had accepted at persist time. */
	readonly parts: readonly PartTag[];
	/**
	 * Host-opaque continuation data. Typed as JSON-safe so the persisted handle
	 * is serializable by construction, not just by convention.
	 */
	readonly meta?: Readonly<Record<string, JsonValue>>;
}

/**
 * Session-based upload backend. Contrast with {@link UploadAdapter}, which is a
 * single `File → UploadResult` call. Implementations own the four lifecycle
 * steps; the adapter-agnostic runner (M3) drives them and handles slicing,
 * per-part retry, progress, resume, and abort.
 *
 * Transient failures (HTTP 5xx, network) should be thrown as `RetryableError`
 * so the runner retries the individual part; non-retryable failures (4xx,
 * shape errors) should throw `AssetValidationError`, matching the single-shot
 * adapter convention.
 */
export interface ResumableUploadAdapter {
	/**
	 * Open — or resume — a multipart session for `file`.
	 *
	 * When `resume` is supplied (a persisted handle from a prior, interrupted
	 * run), the adapter SHOULD reconcile against that backend session — e.g. S3
	 * `ListParts` against `resume.uploadId` — and return a session that echoes
	 * the still-valid `uploadId` and accepted `parts` so the runner skips them.
	 * If `resume.uploadId` is reused, the returned session's effective
	 * `partSize` MUST equal `resume.partSize` — the byte ranges of already-
	 * uploaded parts depend on it. If the backend session is gone or expired the
	 * adapter MUST start fresh: return a new `uploadId` with empty `parts`. When
	 * `resume` is omitted this always starts a fresh session.
	 */
	readonly begin: (
		file: File,
		resume?: PersistedUploadSession,
		options?: UploadAdapterOptions,
	) => Promise<UploadSession>;
	/** Upload one part and return its completion tag. */
	readonly uploadPart: (
		session: UploadSession,
		part: UploadPart,
		options?: UploadAdapterOptions,
	) => Promise<PartTag>;
	/**
	 * Finalize the session once every part is stored. `parts` is the full,
	 * part-number-ordered tag set (resumed + freshly uploaded). Returns the
	 * asset row, which is then validated like any other upload result.
	 */
	readonly complete: (
		session: UploadSession,
		parts: readonly PartTag[],
		options?: UploadAdapterOptions,
	) => Promise<UploadResult>;
	/**
	 * Best-effort teardown of an aborted or failed session (e.g. S3
	 * `AbortMultipartUpload`). The runner calls this on abort; implementations
	 * should swallow their own errors so cleanup never masks the original
	 * failure.
	 */
	readonly abort: (
		session: UploadSession,
		options?: UploadAdapterOptions,
	) => Promise<void>;
}

/**
 * Resumable / multipart upload configuration on {@link AssetManagerOptions}.
 *
 * NOTE: the optional `sessionStore` field is added in M2 once
 * `UploadSessionStore` exists; this M1 shape carries the adapter + tuning only.
 */
export interface ResumableUploadConfig {
	/** The multipart backend driving begin / uploadPart / complete / abort. */
	readonly adapter: ResumableUploadAdapter;
	/**
	 * Bytes per part. Defaults to 8 MiB in the runner. S3 requires every part
	 * except the last to be ≥ 5 MiB, so the S3 adapter clamps smaller values.
	 */
	readonly partSize?: number;
	/**
	 * Minimum file size (bytes) routed through the resumable path; smaller files
	 * use the single-shot `uploader`. Defaults to `partSize` — a file that fits
	 * in one part gains nothing from multipart.
	 */
	readonly threshold?: number;
}

/**
 * Narrow an upload backend to a {@link ResumableUploadAdapter}. The single-shot
 * {@link UploadAdapter} is a function; the resumable adapter is an object with
 * the four lifecycle methods, so a `typeof === "object"` plus method check
 * distinguishes them unambiguously.
 */
export function isResumableAdapter(
	value: UploadAdapter | ResumableUploadAdapter | undefined,
): value is ResumableUploadAdapter {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as ResumableUploadAdapter).begin === "function" &&
		typeof (value as ResumableUploadAdapter).uploadPart === "function" &&
		typeof (value as ResumableUploadAdapter).complete === "function" &&
		typeof (value as ResumableUploadAdapter).abort === "function"
	);
}
