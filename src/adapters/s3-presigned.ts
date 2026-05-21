/**
 * @file S3 presigned adapter — production-ready upload backend that
 * fronts an arbitrary "presign + PUT" service.
 *
 * Pipeline:
 *  1. POST `presignEndpoint` with `{ name, type, size }`.
 *  2. Receive `{ url, publicUrl?, fields?, headers?, id? }`.
 *  3. PUT the file body to `url` with `Content-Type: file.type`.
 *  4. Return a validated `UploadResult` for the registry.
 *
 * Both phases are wrapped in `withRetry()` — 5xx and network failures
 * throw `RetryableError`; 4xx and shape errors throw
 * `AssetValidationError("UPLOAD_FAILED")` (no retry).
 *
 * The adapter never logs file contents — only `name`, `size`, and
 * `mimeType` are safe to log.
 *
 * @experimental Public surface may change before v1.0.
 */

import { AssetValidationError } from "../errors.js";
import { RetryableError, type RetryOptions, withRetry } from "../retry.js";
import type { UploadAdapter, UploadResult } from "../types.js";

// `RetryableError` re-export retained for backward compatibility with
// consumers that imported it from `@anvilkit/plugin-asset-manager/adapters/s3`
// in earlier releases. New code should import from the canonical entry:
// `@anvilkit/plugin-asset-manager/retry`. Identity is preserved across
// both paths so `instanceof` works.
/** @deprecated Import from `@anvilkit/plugin-asset-manager/retry` instead. */
export { RetryableError } from "../retry.js";
export type { RetryOptions } from "../retry.js";

export interface S3PresignedAdapterOptions {
	/** Endpoint that returns a presigned PUT target for the file. */
	readonly presignEndpoint: string | URL;
	/**
	 * Injectable `fetch` implementation. Defaults to `globalThis.fetch`.
	 * Tests pass a fake; production callers can wire in a custom fetch
	 * for instrumentation or redirects.
	 */
	readonly fetch?: typeof globalThis.fetch;
	/** Recorded for logs / diagnostics; the adapter does not validate it. */
	readonly region?: string;
	/** Forwarded to `withRetry()` for both phases. */
	readonly retry?: RetryOptions;
	/** Aborts the in-flight presign + PUT (and any retry sleeps). */
	readonly signal?: AbortSignal;
	/** Extra headers applied to the presign POST (e.g. auth). */
	readonly headers?: Record<string, string>;
	/** Override the asset id generator. Default: `crypto.randomUUID()`. */
	readonly idGenerator?: () => string;
}

/**
 * Shape returned by `presignEndpoint`. Hosts may return additional
 * fields — the adapter ignores them.
 */
export interface S3PresignResponse {
	/** Presigned PUT URL. */
	readonly url: string;
	/** Canonical URL recorded on the asset. Defaults to a stripped `url`. */
	readonly publicUrl?: string;
	/** Optional headers to forward on the PUT (e.g. `x-amz-*`). */
	readonly headers?: Record<string, string>;
	/** Optional asset id; falls back to `idGenerator()`. */
	readonly id?: string;
}

export function s3PresignedAdapter(
	options: S3PresignedAdapterOptions,
): UploadAdapter {
	const fetchImpl = options.fetch ?? globalThis.fetch;
	if (typeof fetchImpl !== "function") {
		throw new Error(
			"s3PresignedAdapter: no `fetch` implementation available. Pass `options.fetch`.",
		);
	}
	const generateId = options.idGenerator ?? defaultIdGenerator;

	return async (file, callOptions) => {
		// Combine the construction-time signal with the per-call signal so
		// aborting either one cancels the upload. `dispose()` removes the
		// fallback bridge listeners on completion so a long-lived
		// `options.signal` doesn't accumulate one closure per upload.
		const { signal, dispose } = combineSignals(
			options.signal,
			callOptions?.signal,
		);

		try {
			const presign = await withRetry(
				() => requestPresign(file, fetchImpl, options, signal),
				{ ...(options.retry ?? {}), signal },
			);

			await withRetry(() => putToS3(file, presign, fetchImpl, signal), {
				...(options.retry ?? {}),
				signal,
			});

			const id = presign.id ?? generateId();
			const publicUrl = presign.publicUrl ?? stripQueryAndFragment(presign.url);

			const result: UploadResult = {
				id,
				url: publicUrl,
				...(file.name ? { name: file.name } : {}),
				meta: {
					size: file.size,
					...(file.type ? { mimeType: file.type } : {}),
				},
			};
			return result;
		} finally {
			dispose();
		}
	};
}

async function requestPresign(
	file: File,
	fetchImpl: typeof globalThis.fetch,
	options: S3PresignedAdapterOptions,
	signal?: AbortSignal,
): Promise<S3PresignResponse> {
	const url =
		typeof options.presignEndpoint === "string"
			? options.presignEndpoint
			: options.presignEndpoint.toString();
	const body = JSON.stringify({
		name: file.name,
		type: file.type,
		size: file.size,
	});

	let response: Response;
	try {
		response = await fetchImpl(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(options.headers ?? {}),
			},
			body,
			...(signal ? { signal } : {}),
		});
	} catch (cause) {
		// Network-level failure (DNS, TCP, TLS) — retryable.
		throw new RetryableError(
			`s3PresignedAdapter: presign request failed (${describeError(cause)}).`,
			{ cause },
		);
	}

	if (response.status >= 500) {
		throw new RetryableError(
			`s3PresignedAdapter: presign returned ${response.status}.`,
			{ retryAfterMs: parseRetryAfter(response.headers.get("retry-after")) },
		);
	}
	if (!response.ok) {
		throw new AssetValidationError(
			"UPLOAD_FAILED",
			`s3PresignedAdapter: presign returned ${response.status}.`,
		);
	}

	let payload: unknown;
	try {
		payload = await response.json();
	} catch (cause) {
		throw new AssetValidationError(
			"UPLOAD_FAILED",
			"s3PresignedAdapter: presign response was not JSON.",
			{ cause },
		);
	}

	if (!isPresignResponse(payload)) {
		throw new AssetValidationError(
			"UPLOAD_FAILED",
			"s3PresignedAdapter: presign response missing `url`.",
		);
	}

	return payload;
}

async function putToS3(
	file: File,
	presign: S3PresignResponse,
	fetchImpl: typeof globalThis.fetch,
	signal: AbortSignal | undefined,
): Promise<void> {
	const headers: Record<string, string> = {
		...(file.type ? { "Content-Type": file.type } : {}),
		...(presign.headers ?? {}),
	};
	let response: Response;
	try {
		response = await fetchImpl(presign.url, {
			method: "PUT",
			body: file,
			headers,
			...(signal ? { signal } : {}),
		});
	} catch (cause) {
		throw new RetryableError(
			`s3PresignedAdapter: PUT failed (${describeError(cause)}).`,
			{ cause },
		);
	}

	if (response.status >= 500) {
		throw new RetryableError(
			`s3PresignedAdapter: PUT returned ${response.status}.`,
			{ retryAfterMs: parseRetryAfter(response.headers.get("retry-after")) },
		);
	}
	if (!response.ok) {
		throw new AssetValidationError(
			"UPLOAD_FAILED",
			`s3PresignedAdapter: PUT returned ${response.status}.`,
		);
	}
}

function isPresignResponse(value: unknown): value is S3PresignResponse {
	return (
		value !== null &&
		typeof value === "object" &&
		typeof (value as { url?: unknown }).url === "string" &&
		(value as { url: string }).url.length > 0
	);
}

function stripQueryAndFragment(url: string): string {
	const queryIdx = url.indexOf("?");
	const fragmentIdx = url.indexOf("#");
	const cuts = [queryIdx, fragmentIdx].filter((i) => i !== -1);
	if (cuts.length === 0) {
		return url;
	}
	return url.slice(0, Math.min(...cuts));
}

function parseRetryAfter(header: string | null): number | undefined {
	if (header === null) {
		return undefined;
	}
	const seconds = Number(header);
	if (Number.isFinite(seconds) && seconds >= 0) {
		return seconds * 1_000;
	}
	const date = Date.parse(header);
	if (!Number.isNaN(date)) {
		return Math.max(0, date - Date.now());
	}
	return undefined;
}

function describeError(error: unknown): string {
	if (error instanceof Error) {
		return error.message || error.name;
	}
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
	/**
	 * Detaches the bridge listeners installed by the manual-combiner
	 * fallback so they don't accumulate on a long-lived input signal
	 * across many uploads. No-op when `AbortSignal.any` was used or when
	 * either input was missing.
	 */
	readonly dispose: () => void;
}

const NOOP_DISPOSE = (): void => undefined;

/**
 * Combine zero, one, or two `AbortSignal`s into a single signal that
 * fires when any input aborts. Returns a `dispose` callback the caller
 * MUST invoke in `finally` so the fallback bridge listeners are removed
 * after a successful upload (the native `AbortSignal.any` path cleans
 * itself up; the dispose is a no-op there).
 */
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
	if (a.aborted) {
		onAbortA();
	} else {
		a.addEventListener("abort", onAbortA, { once: true });
	}
	if (b.aborted) {
		onAbortB();
	} else {
		b.addEventListener("abort", onAbortB, { once: true });
	}
	return {
		signal: controller.signal,
		dispose: () => {
			a.removeEventListener("abort", onAbortA);
			b.removeEventListener("abort", onAbortB);
		},
	};
}
