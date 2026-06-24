/**
 * @file Adapter-agnostic resumable-upload runner (PRD 0004 §5.1 — M3).
 *
 * Drives any {@link ResumableUploadAdapter} through a full multipart lifecycle:
 * slice the file into ordered parts, resume the ones a prior run already
 * uploaded, upload the rest with per-part retry, emit progress, finalize, and
 * tear down on abort. It is deliberately backend-neutral — it never assumes S3;
 * the S3 specifics live in the adapter (M4).
 *
 * Trust boundary: this returns the adapter's raw {@link UploadResult}. The
 * pipeline (M5) runs it through `validateUploadResult()` exactly as it does for
 * single-shot uploads, so the runner stays a pure orchestrator.
 *
 * @experimental Public surface may change before v1.0.
 */

import type {
	PartTag,
	PersistedUploadSession,
	ResumableUploadAdapter,
	UploadPart,
	UploadSession,
	UploadSessionStore,
} from "../types/resumable.js";
import type { UploadResult } from "../types/types.js";
import { AssetValidationError } from "./errors.js";
import { type RetryOptions, withRetry } from "./retry.js";
import { createUploadSessionStore } from "./upload-session-store.js";

/** 8 MiB — comfortably above S3's 5 MiB minimum part size. */
const DEFAULT_PART_SIZE = 8 * 1024 * 1024;

/** Progress snapshot emitted as parts complete. */
export interface ResumableUploadProgress {
	/** Bytes confirmed stored so far (sum of completed part sizes). */
	readonly uploadedBytes: number;
	/** Total bytes in the source file. */
	readonly totalBytes: number;
	/** Number of parts confirmed stored. */
	readonly uploadedParts: number;
	/** Total number of parts in the plan. */
	readonly totalParts: number;
}

/** Options for {@link runResumableUpload}. */
export interface RunResumableUploadOptions {
	/**
	 * Bytes per part for a *fresh* upload. Ignored when resuming — the locked
	 * size from the persisted/echoed session is used instead. Defaults to 8 MiB.
	 */
	readonly partSize?: number;
	/** Aborts the upload (and any in-flight part + retry sleeps). */
	readonly signal?: AbortSignal;
	/** Called after `begin` (with resumed progress) and after each part completes. */
	readonly onProgress?: (progress: ResumableUploadProgress) => void;
	/**
	 * Where progress is persisted for resume. Defaults to the built-in
	 * `createUploadSessionStore()` (localStorage, in-memory fallback).
	 */
	readonly sessionStore?: UploadSessionStore;
	/** Forwarded to `withRetry()` for each part upload (retry-by-part). */
	readonly retry?: RetryOptions;
}

/**
 * Upload `file` through `adapter` as a resumable multipart upload. Returns the
 * adapter's `UploadResult` (unvalidated — the caller validates). Rejects on
 * abort (after best-effort backend teardown) or when a part's retries are
 * exhausted (leaving the session persisted so a later call can resume).
 */
export async function runResumableUpload(
	adapter: ResumableUploadAdapter,
	file: File,
	options: RunResumableUploadOptions = {},
): Promise<UploadResult> {
	const sessionStore = options.sessionStore ?? createUploadSessionStore();
	const { signal } = options;
	const callOptions = signal ? { signal } : undefined;

	throwIfAborted(signal);

	// Load any persisted handle and let the adapter reconcile against it. The
	// adapter — not the persisted blob — is authoritative about which parts
	// still exist, so we seed `completed` from what `begin` returns.
	const persisted = (await sessionStore.load(file)) ?? undefined;
	const session = await adapter.begin(file, persisted, callOptions);

	const resumedParts = session.parts ?? [];

	// Resolve the part size. When resuming accepted parts, the locked persisted
	// size is authoritative: an adapter that echoes a *different* size would
	// remap the skipped part numbers onto different byte ranges and complete a
	// corrupt object, so reject that contract violation outright.
	let effectivePartSize: number;
	if (persisted !== undefined && resumedParts.length > 0) {
		const locked = persisted.partSize;
		if (session.partSize !== undefined && session.partSize !== locked) {
			throw new AssetValidationError(
				"PART_SIZE_MISMATCH",
				`runResumableUpload: resumed session changed part size (${locked} → ${session.partSize}); refusing to corrupt already-uploaded parts.`,
			);
		}
		effectivePartSize = locked;
	} else {
		effectivePartSize =
			session.partSize ?? options.partSize ?? DEFAULT_PART_SIZE;
	}

	// A non-positive size would never advance the slice loop (hang); a
	// fractional / NaN size would produce unsafe ranges. Guard before planning.
	if (!Number.isSafeInteger(effectivePartSize) || effectivePartSize <= 0) {
		throw new AssetValidationError(
			"INVALID_PART_SIZE",
			`runResumableUpload: part size must be a positive integer (got ${effectivePartSize}).`,
		);
	}

	const plan = planParts(file, effectivePartSize);
	const sizeByPart = new Map(plan.map((p) => [p.partNumber, p.end - p.start]));

	// Seed completed parts from what the adapter reconciled, but drop any tag
	// whose part number is outside the current plan — an out-of-range tag would
	// inflate progress and pollute the persisted handle.
	const completed = new Map<number, PartTag>();
	for (const tag of resumedParts) {
		if (sizeByPart.has(tag.partNumber)) completed.set(tag.partNumber, tag);
	}

	const emitProgress = (): void => {
		options.onProgress?.({
			uploadedBytes: sumCompletedBytes(completed, sizeByPart),
			totalBytes: file.size,
			uploadedParts: completed.size,
			totalParts: plan.length,
		});
	};

	emitProgress();

	try {
		for (const part of plan) {
			throwIfAborted(signal);
			if (completed.has(part.partNumber)) continue; // resumed — skip
			const tag = await withRetry(
				() => adapter.uploadPart(session, part, callOptions),
				{ ...(options.retry ?? {}), ...(signal ? { signal } : {}) },
			);
			completed.set(part.partNumber, tag);
			// Persist incremental progress so an interruption resumes from here.
			await sessionStore.save(
				file,
				toPersisted(session, effectivePartSize, completed),
			);
			emitProgress();
		}

		const orderedTags = plan.map((part) => {
			const tag = completed.get(part.partNumber);
			if (tag === undefined) {
				throw new Error(
					`runResumableUpload: missing tag for part ${part.partNumber}.`,
				);
			}
			return tag;
		});

		const result = await adapter.complete(session, orderedTags, callOptions);
		await sessionStore.clear(file);
		return result;
	} catch (error) {
		// On abort, tear down the backend session and drop the dead handle. On any
		// other failure, leave the session persisted so a later call can resume.
		if (isAbort(error, signal)) {
			await safeAbort(adapter, session);
			await sessionStore.clear(file);
		}
		throw error;
	}
}

function planParts(file: File, partSize: number): UploadPart[] {
	const parts: UploadPart[] = [];
	const size = file.size;
	let partNumber = 1;
	for (let start = 0; start < size; start += partSize) {
		const end = Math.min(start + partSize, size);
		parts.push({ partNumber, start, end, blob: file.slice(start, end) });
		partNumber += 1;
	}
	return parts;
}

function sumCompletedBytes(
	completed: Map<number, PartTag>,
	sizeByPart: Map<number, number>,
): number {
	let total = 0;
	for (const partNumber of completed.keys()) {
		total += sizeByPart.get(partNumber) ?? 0;
	}
	return total;
}

function toPersisted(
	session: UploadSession,
	partSize: number,
	completed: Map<number, PartTag>,
): PersistedUploadSession {
	const parts = [...completed.values()].sort(
		(a, b) => a.partNumber - b.partNumber,
	);
	return {
		uploadId: session.uploadId,
		partSize,
		parts,
		...(session.meta ? { meta: session.meta } : {}),
	};
}

async function safeAbort(
	adapter: ResumableUploadAdapter,
	session: UploadSession,
): Promise<void> {
	try {
		// Intentionally NO signal: teardown runs in the abort path, where the
		// caller's signal is already aborted — forwarding it would cancel the
		// abort request itself and leave the backend multipart session dangling.
		await adapter.abort(session);
	} catch {
		// Best-effort teardown — never let cleanup mask the original error.
	}
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
	if (signal?.aborted) return true;
	return (
		error !== null &&
		typeof error === "object" &&
		(error as { name?: unknown }).name === "AbortError"
	);
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw toAbortError(signal);
}

function toAbortError(signal: AbortSignal): Error {
	const reason = signal.reason;
	if (reason instanceof Error) return reason;
	if (typeof DOMException !== "undefined") {
		return new DOMException("Aborted", "AbortError");
	}
	const error = new Error("Aborted");
	error.name = "AbortError";
	return error;
}
