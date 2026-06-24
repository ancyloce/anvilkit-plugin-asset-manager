/**
 * @file S3 multipart resumable adapter (PRD 0004 §5.1 — M4).
 *
 * A {@link ResumableUploadAdapter} that fronts an S3-compatible multipart
 * upload WITHOUT bundling the AWS SDK — exactly like {@link s3PresignedAdapter}
 * fronts a single presigned PUT. All S3 calls are brokered through one host
 * `endpoint` that the adapter POSTs JSON to, discriminated by `action`:
 *
 *  - `create`     → host runs `CreateMultipartUpload`, returns `{ uploadId, key?, partSize? }`
 *  - `sign-part`  → host presigns one `UploadPart` PUT, returns `{ url, headers? }`
 *  - `complete`   → host runs `CompleteMultipartUpload`, returns `{ url, publicUrl?, id? }`
 *  - `abort`      → host runs `AbortMultipartUpload`
 *  - `list-parts` → host runs `ListParts` for resume, returns `{ parts, key? }` (404 ⇒ gone)
 *
 * Retry split: `begin` / `complete` / `abort` retry internally via `withRetry`
 * (the runner does not retry them). `uploadPart` does NOT retry internally — the
 * runner's per-part `withRetry` re-invokes it, which RE-SIGNS the part URL each
 * attempt (presigned URLs expire), so a fresh URL is used on every retry.
 *
 * @experimental Public surface may change before v1.0.
 */

import type {
	PartTag,
	ResumableUploadAdapter,
	UploadPart,
	UploadSession,
} from "../types/resumable.js";
import type { UploadResult } from "../types/types.js";
import { AssetValidationError } from "../utils/errors.js";
import {
	RetryableError,
	type RetryOptions,
	withRetry,
} from "../utils/retry.js";

/** 8 MiB default; clamped up to S3's 5 MiB minimum non-final part size. */
const DEFAULT_PART_SIZE = 8 * 1024 * 1024;
const S3_MIN_PART_SIZE = 5 * 1024 * 1024;

/** Configuration for {@link s3MultipartAdapter}. */
export interface S3MultipartAdapterOptions {
	/** Endpoint that brokers the S3 multipart actions (see file header). */
	readonly endpoint: string | URL;
	/** Injectable `fetch`. Defaults to `globalThis.fetch`. */
	readonly fetch?: typeof globalThis.fetch;
	/** Bytes per part. Clamped to S3's 5 MiB minimum. Defaults to 8 MiB. */
	readonly partSize?: number;
	/** Forwarded to `withRetry()` for `begin` / `complete` / `abort`. */
	readonly retry?: RetryOptions;
	/** Construction-time signal, combined with each call's signal. */
	readonly signal?: AbortSignal;
	/** Extra headers applied to every broker POST (e.g. auth). */
	readonly headers?: Record<string, string>;
	/** Override the fallback asset id generator. Default: `crypto.randomUUID()`. */
	readonly idGenerator?: () => string;
}

interface CreateResponse {
	readonly uploadId: string;
	readonly key?: string;
	readonly partSize?: number;
}
interface SignPartResponse {
	readonly url: string;
	readonly headers?: Record<string, string>;
}
interface CompleteResponse {
	readonly url: string;
	readonly publicUrl?: string;
	readonly id?: string;
}
interface ListPartsResponse {
	readonly parts: readonly PartTag[];
	readonly key?: string;
}

/** Create a resumable adapter backed by an S3 multipart broker endpoint. */
export function s3MultipartAdapter(
	options: S3MultipartAdapterOptions,
): ResumableUploadAdapter {
	const fetchImpl = options.fetch ?? globalThis.fetch;
	if (typeof fetchImpl !== "function") {
		throw new Error(
			"s3MultipartAdapter: no `fetch` implementation available. Pass `options.fetch`.",
		);
	}
	const generateId = options.idGenerator ?? defaultIdGenerator;
	const partSize = Math.max(
		options.partSize ?? DEFAULT_PART_SIZE,
		S3_MIN_PART_SIZE,
	);
	const endpoint =
		typeof options.endpoint === "string"
			? options.endpoint
			: options.endpoint.toString();
	const retry = options.retry ?? {};

	const keyOf = (session: {
		meta?: UploadSession["meta"];
	}): string | undefined =>
		typeof session.meta?.key === "string" ? session.meta.key : undefined;

	return {
		async begin(file, resume, callOptions) {
			const { signal, dispose } = combineSignals(
				options.signal,
				callOptions?.signal,
			);
			try {
				if (resume) {
					const resumeKey =
						typeof resume.meta?.key === "string" ? resume.meta.key : undefined;
					const listed = await withRetry(
						() =>
							listParts(
								endpoint,
								fetchImpl,
								options.headers,
								resume.uploadId,
								resumeKey,
								signal,
							),
						{ ...retry, ...(signal ? { signal } : {}) },
					);
					if (listed !== undefined) {
						const key = resumeKey ?? listed.key;
						return {
							uploadId: resume.uploadId,
							parts: listed.parts,
							// Echo the LOCKED size — the runner rejects any drift.
							partSize: resume.partSize,
							meta: buildMeta(key, resume.meta),
						};
					}
					// MPU is gone (ListParts 404) → fall through to a fresh upload.
				}

				const created = await withRetry(
					() =>
						createSession(
							endpoint,
							fetchImpl,
							options.headers,
							file,
							partSize,
							signal,
						),
					{ ...retry, ...(signal ? { signal } : {}) },
				);
				return {
					uploadId: created.uploadId,
					parts: [],
					partSize: clampPartSize(created.partSize) ?? partSize,
					meta: buildMeta(created.key, fileMeta(file)),
				};
			} finally {
				dispose();
			}
		},

		async uploadPart(session, part, callOptions) {
			// No internal retry: the runner re-invokes this on RetryableError,
			// re-signing the URL (presigned URLs expire).
			const { signal, dispose } = combineSignals(
				options.signal,
				callOptions?.signal,
			);
			try {
				const signed = await signPart(
					endpoint,
					fetchImpl,
					options.headers,
					session.uploadId,
					keyOf(session),
					part.partNumber,
					signal,
				);
				const etag = await putPart(fetchImpl, signed, part, signal);
				return { partNumber: part.partNumber, etag };
			} finally {
				dispose();
			}
		},

		async complete(session, parts, callOptions) {
			const { signal, dispose } = combineSignals(
				options.signal,
				callOptions?.signal,
			);
			try {
				const completed = await withRetry(
					() =>
						completeSession(
							endpoint,
							fetchImpl,
							options.headers,
							session.uploadId,
							keyOf(session),
							parts,
							signal,
						),
					{ ...retry, ...(signal ? { signal } : {}) },
				);
				const id = completed.id ?? generateId();
				const url = completed.publicUrl ?? stripQueryAndFragment(completed.url);
				return buildResult(id, url, session.meta);
			} finally {
				dispose();
			}
		},

		async abort(session, callOptions) {
			const { signal, dispose } = combineSignals(
				options.signal,
				callOptions?.signal,
			);
			try {
				await withRetry(
					() =>
						abortSession(
							endpoint,
							fetchImpl,
							options.headers,
							session.uploadId,
							keyOf(session),
							signal,
						),
					{ ...retry, ...(signal ? { signal } : {}) },
				);
			} finally {
				dispose();
			}
		},
	};
}

// ── broker calls ────────────────────────────────────────────────────────────

async function createSession(
	endpoint: string,
	fetchImpl: typeof globalThis.fetch,
	headers: Record<string, string> | undefined,
	file: File,
	partSize: number,
	signal: AbortSignal | undefined,
): Promise<CreateResponse> {
	const payload = await postAction(
		endpoint,
		fetchImpl,
		headers,
		{
			action: "create",
			name: file.name,
			type: file.type,
			size: file.size,
			partSize,
		},
		signal,
	);
	if (
		!isObject(payload) ||
		typeof payload.uploadId !== "string" ||
		payload.uploadId === ""
	) {
		throw new AssetValidationError(
			"UPLOAD_FAILED",
			"s3MultipartAdapter: create response missing `uploadId`.",
		);
	}
	if (!isOptionalString(payload.key)) {
		throw badShape("create", "`key` must be a string");
	}
	if (
		payload.partSize !== undefined &&
		!isPositiveSafeInteger(payload.partSize)
	) {
		throw badShape("create", "`partSize` must be a positive integer");
	}
	return {
		uploadId: payload.uploadId,
		...(payload.key !== undefined ? { key: payload.key as string } : {}),
		...(payload.partSize !== undefined
			? { partSize: payload.partSize as number }
			: {}),
	};
}

async function signPart(
	endpoint: string,
	fetchImpl: typeof globalThis.fetch,
	headers: Record<string, string> | undefined,
	uploadId: string,
	key: string | undefined,
	partNumber: number,
	signal: AbortSignal | undefined,
): Promise<SignPartResponse> {
	const payload = await postAction(
		endpoint,
		fetchImpl,
		headers,
		{ action: "sign-part", uploadId, key, partNumber },
		signal,
	);
	if (
		!isObject(payload) ||
		typeof payload.url !== "string" ||
		payload.url === ""
	) {
		throw new AssetValidationError(
			"UPLOAD_FAILED",
			"s3MultipartAdapter: sign-part response missing `url`.",
		);
	}
	if (payload.headers !== undefined && !isStringRecord(payload.headers)) {
		throw badShape("sign-part", "`headers` must be a string map");
	}
	return {
		url: payload.url,
		...(payload.headers !== undefined
			? { headers: payload.headers as Record<string, string> }
			: {}),
	};
}

async function completeSession(
	endpoint: string,
	fetchImpl: typeof globalThis.fetch,
	headers: Record<string, string> | undefined,
	uploadId: string,
	key: string | undefined,
	parts: readonly PartTag[],
	signal: AbortSignal | undefined,
): Promise<CompleteResponse> {
	const payload = await postAction(
		endpoint,
		fetchImpl,
		headers,
		{ action: "complete", uploadId, key, parts },
		signal,
	);
	if (
		!isObject(payload) ||
		typeof payload.url !== "string" ||
		payload.url === ""
	) {
		throw new AssetValidationError(
			"UPLOAD_FAILED",
			"s3MultipartAdapter: complete response missing `url`.",
		);
	}
	if (!isOptionalString(payload.publicUrl)) {
		throw badShape("complete", "`publicUrl` must be a string");
	}
	if (!isOptionalString(payload.id)) {
		throw badShape("complete", "`id` must be a string");
	}
	return {
		url: payload.url,
		...(payload.publicUrl !== undefined
			? { publicUrl: payload.publicUrl as string }
			: {}),
		...(payload.id !== undefined ? { id: payload.id as string } : {}),
	};
}

function abortSession(
	endpoint: string,
	fetchImpl: typeof globalThis.fetch,
	headers: Record<string, string> | undefined,
	uploadId: string,
	key: string | undefined,
	signal: AbortSignal | undefined,
): Promise<unknown> {
	return postAction(
		endpoint,
		fetchImpl,
		headers,
		{ action: "abort", uploadId, key },
		signal,
	);
}

/** Returns the listed parts, or `undefined` when the MPU is gone (404). */
async function listParts(
	endpoint: string,
	fetchImpl: typeof globalThis.fetch,
	headers: Record<string, string> | undefined,
	uploadId: string,
	key: string | undefined,
	signal: AbortSignal | undefined,
): Promise<ListPartsResponse | undefined> {
	let response: Response;
	try {
		response = await fetchImpl(endpoint, {
			method: "POST",
			headers: { "Content-Type": "application/json", ...(headers ?? {}) },
			body: JSON.stringify({ action: "list-parts", uploadId, key }),
			...(signal ? { signal } : {}),
		});
	} catch (cause) {
		throw new RetryableError(
			`s3MultipartAdapter: list-parts request failed (${describeError(cause)}).`,
			{ cause },
		);
	}
	if (response.status === 404) return undefined; // MPU expired/aborted → fresh
	if (response.status >= 500) {
		throw new RetryableError(
			`s3MultipartAdapter: list-parts returned ${response.status}.`,
			{ retryAfterMs: parseRetryAfter(response.headers.get("retry-after")) },
		);
	}
	if (!response.ok) {
		throw new AssetValidationError(
			"UPLOAD_FAILED",
			`s3MultipartAdapter: list-parts returned ${response.status}.`,
		);
	}
	const payload = await parseJson(response, "list-parts");
	if (!isObject(payload) || !isPartTagArray(payload.parts)) {
		throw new AssetValidationError(
			"UPLOAD_FAILED",
			"s3MultipartAdapter: list-parts response has a missing or malformed `parts` array.",
		);
	}
	if (!isOptionalString(payload.key)) {
		throw badShape("list-parts", "`key` must be a string");
	}
	return {
		parts: payload.parts,
		...(payload.key !== undefined ? { key: payload.key as string } : {}),
	};
}

async function putPart(
	fetchImpl: typeof globalThis.fetch,
	signed: SignPartResponse,
	part: UploadPart,
	signal: AbortSignal | undefined,
): Promise<string> {
	let response: Response;
	try {
		response = await fetchImpl(signed.url, {
			method: "PUT",
			body: part.blob,
			...(signed.headers ? { headers: signed.headers } : {}),
			...(signal ? { signal } : {}),
		});
	} catch (cause) {
		throw new RetryableError(
			`s3MultipartAdapter: part ${part.partNumber} PUT failed (${describeError(cause)}).`,
			{ cause },
		);
	}
	if (response.status >= 500) {
		throw new RetryableError(
			`s3MultipartAdapter: part ${part.partNumber} PUT returned ${response.status}.`,
			{ retryAfterMs: parseRetryAfter(response.headers.get("retry-after")) },
		);
	}
	if (!response.ok) {
		throw new AssetValidationError(
			"UPLOAD_FAILED",
			`s3MultipartAdapter: part ${part.partNumber} PUT returned ${response.status}.`,
		);
	}
	const etag = response.headers.get("etag");
	if (etag === null || etag === "") {
		throw new AssetValidationError(
			"UPLOAD_FAILED",
			`s3MultipartAdapter: part ${part.partNumber} PUT returned no ETag header. Expose it via S3 CORS \`ExposeHeaders: ["ETag"]\`.`,
		);
	}
	return etag;
}

/** POST one broker action, classifying transport failures for `withRetry`. */
async function postAction(
	endpoint: string,
	fetchImpl: typeof globalThis.fetch,
	headers: Record<string, string> | undefined,
	body: Record<string, unknown>,
	signal: AbortSignal | undefined,
): Promise<unknown> {
	let response: Response;
	try {
		response = await fetchImpl(endpoint, {
			method: "POST",
			headers: { "Content-Type": "application/json", ...(headers ?? {}) },
			body: JSON.stringify(body),
			...(signal ? { signal } : {}),
		});
	} catch (cause) {
		throw new RetryableError(
			`s3MultipartAdapter: ${String(body.action)} request failed (${describeError(cause)}).`,
			{ cause },
		);
	}
	if (response.status >= 500) {
		throw new RetryableError(
			`s3MultipartAdapter: ${String(body.action)} returned ${response.status}.`,
			{ retryAfterMs: parseRetryAfter(response.headers.get("retry-after")) },
		);
	}
	if (!response.ok) {
		throw new AssetValidationError(
			"UPLOAD_FAILED",
			`s3MultipartAdapter: ${String(body.action)} returned ${response.status}.`,
		);
	}
	// `abort` may legitimately return an empty body; tolerate non-JSON there.
	if (body.action === "abort") return undefined;
	return parseJson(response, String(body.action));
}

async function parseJson(response: Response, action: string): Promise<unknown> {
	try {
		return await response.json();
	} catch (cause) {
		throw new AssetValidationError(
			"UPLOAD_FAILED",
			`s3MultipartAdapter: ${action} response was not JSON.`,
			{ cause },
		);
	}
}

// ── helpers ───────────────────────────────────────────────────────────────

function fileMeta(file: File): Record<string, string | number> {
	return {
		name: file.name,
		size: file.size,
		...(file.type ? { type: file.type } : {}),
	};
}

function buildMeta(
	key: string | undefined,
	base: UploadSession["meta"] | undefined,
): UploadSession["meta"] {
	return Object.freeze({
		...(base ?? {}),
		...(key !== undefined ? { key } : {}),
	});
}

function buildResult(
	id: string,
	url: string,
	meta: UploadSession["meta"] | undefined,
): UploadResult {
	const name = typeof meta?.name === "string" ? meta.name : undefined;
	const size = typeof meta?.size === "number" ? meta.size : undefined;
	const type = typeof meta?.type === "string" ? meta.type : undefined;
	const resultMeta =
		size !== undefined || type !== undefined
			? {
					...(size !== undefined ? { size } : {}),
					...(type !== undefined ? { mimeType: type } : {}),
				}
			: undefined;
	return {
		id,
		url,
		...(name ? { name } : {}),
		...(resultMeta ? { meta: resultMeta } : {}),
	};
}

function clampPartSize(value: number | undefined): number | undefined {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
		return undefined;
	}
	return Math.max(value, S3_MIN_PART_SIZE);
}

function isObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isOptionalString(value: unknown): boolean {
	return value === undefined || typeof value === "string";
}

function isPositiveSafeInteger(value: unknown): boolean {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isStringRecord(value: unknown): value is Record<string, string> {
	return (
		isObject(value) && Object.values(value).every((v) => typeof v === "string")
	);
}

function isPartTagArray(value: unknown): value is PartTag[] {
	return (
		Array.isArray(value) &&
		value.every(
			(p) =>
				isObject(p) &&
				typeof p.partNumber === "number" &&
				Number.isInteger(p.partNumber) &&
				p.partNumber >= 1 &&
				typeof p.etag === "string",
		)
	);
}

function badShape(action: string, detail: string): AssetValidationError {
	return new AssetValidationError(
		"UPLOAD_FAILED",
		`s3MultipartAdapter: ${action} response has an invalid shape — ${detail}.`,
	);
}

function stripQueryAndFragment(url: string): string {
	const cuts = [url.indexOf("?"), url.indexOf("#")].filter((i) => i !== -1);
	return cuts.length === 0 ? url : url.slice(0, Math.min(...cuts));
}

function parseRetryAfter(header: string | null): number | undefined {
	if (header === null) return undefined;
	const seconds = Number(header);
	if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
	const date = Date.parse(header);
	if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
	return undefined;
}

function describeError(error: unknown): string {
	if (error instanceof Error) return error.message || error.name;
	return String(error);
}

function defaultIdGenerator(): string {
	if (
		typeof globalThis.crypto !== "undefined" &&
		typeof globalThis.crypto.randomUUID === "function"
	) {
		return globalThis.crypto.randomUUID();
	}
	return `asset-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

interface CombinedSignal {
	readonly signal: AbortSignal | undefined;
	readonly dispose: () => void;
}

const NOOP_DISPOSE = (): void => undefined;

/** Combine the construction-time and per-call signals into one. */
function combineSignals(a?: AbortSignal, b?: AbortSignal): CombinedSignal {
	if (!a) return { signal: b, dispose: NOOP_DISPOSE };
	if (!b) return { signal: a, dispose: NOOP_DISPOSE };
	if (a === b) return { signal: a, dispose: NOOP_DISPOSE };
	const anyImpl = (
		AbortSignal as unknown as {
			any?: (signals: AbortSignal[]) => AbortSignal;
		}
	).any;
	if (typeof anyImpl === "function") {
		return { signal: anyImpl([a, b]), dispose: NOOP_DISPOSE };
	}
	const controller = new AbortController();
	const onAbortA = (): void => {
		if (!controller.signal.aborted) controller.abort(a.reason);
	};
	const onAbortB = (): void => {
		if (!controller.signal.aborted) controller.abort(b.reason);
	};
	if (a.aborted) onAbortA();
	else a.addEventListener("abort", onAbortA, { once: true });
	if (b.aborted) onAbortB();
	else b.addEventListener("abort", onAbortB, { once: true });
	return {
		signal: controller.signal,
		dispose: () => {
			a.removeEventListener("abort", onAbortA);
			b.removeEventListener("abort", onAbortB);
		},
	};
}
