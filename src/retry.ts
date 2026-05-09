/**
 * @file Retry helpers used by network-bound upload adapters.
 *
 * `RetryableError` marks a thrown error as transient. `withRetry()`
 * wraps an async function with exponential backoff plus full-jitter,
 * abort-aware sleep, and an optional `retryAfterMs` override carried
 * on the error.
 *
 * @experimental Public surface may change before v1.0. Pinned by the
 * package's `api/api-snapshot.json` once the snapshot script is
 * extended to scan this entrypoint.
 */

/**
 * Marks an error as transient — `withRetry()` will reschedule the
 * underlying call rather than rethrow.
 *
 * Adapters should throw `RetryableError` for HTTP 5xx, network
 * failures, and other recoverable conditions; non-retryable errors
 * (4xx, schema mismatches, abort) should be thrown as plain `Error`
 * subclasses (typically `AssetValidationError`).
 *
 * The optional `retryAfterMs` overrides the next computed delay,
 * useful when the server returned a `Retry-After` header.
 */
export class RetryableError extends Error {
	readonly retryAfterMs?: number;

	constructor(
		message: string,
		options?: { readonly cause?: unknown; readonly retryAfterMs?: number },
	) {
		super(message);
		this.name = "RetryableError";

		if (options && "cause" in options) {
			this.cause = options.cause;
		}
		if (options?.retryAfterMs !== undefined) {
			this.retryAfterMs = options.retryAfterMs;
		}
	}
}

export interface RetryOptions {
	/**
	 * Maximum number of retry attempts after the initial call.
	 * `maxRetries: 3` means up to 4 total invocations.
	 *
	 * @default 3
	 */
	readonly maxRetries?: number;
	/**
	 * Base delay in milliseconds. The actual delay grows exponentially
	 * (`baseDelayMs * 2^attempt`) and is then jittered.
	 *
	 * @default 250
	 */
	readonly baseDelayMs?: number;
	/**
	 * Cap on the computed backoff delay (before jitter).
	 *
	 * @default 8000
	 */
	readonly maxDelayMs?: number;
	/** Aborts both the in-flight call and any pending retry sleep. */
	readonly signal?: AbortSignal;
	/** Defaults to `Math.random`. Override for deterministic tests. */
	readonly jitter?: () => number;
	/** Defaults to a `setTimeout`-based, abort-aware sleep. */
	readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 250;
const DEFAULT_MAX_DELAY_MS = 8_000;

/**
 * Run `fn` and retry on `RetryableError` with full-jitter exponential
 * backoff. Honors `signal` between attempts and during sleep.
 *
 * Resolution order on each error:
 *  1. If the signal is aborted → throw `AbortError` immediately.
 *  2. If the error is not a `RetryableError` → rethrow.
 *  3. If retries are exhausted → rethrow the last error.
 *  4. Otherwise compute backoff, sleep, and try again.
 */
export async function withRetry<T>(
	fn: (attempt: number) => Promise<T>,
	options: RetryOptions = {},
): Promise<T> {
	const {
		maxRetries = DEFAULT_MAX_RETRIES,
		baseDelayMs = DEFAULT_BASE_DELAY_MS,
		maxDelayMs = DEFAULT_MAX_DELAY_MS,
		signal,
		jitter = Math.random,
		sleep = defaultSleep,
	} = options;

	let attempt = 0;

	while (true) {
		throwIfAborted(signal);
		try {
			return await fn(attempt);
		} catch (error) {
			throwIfAborted(signal);
			if (!isRetryable(error)) {
				throw error;
			}
			if (attempt >= maxRetries) {
				throw error;
			}
			const delay = computeDelay({
				attempt,
				baseDelayMs,
				maxDelayMs,
				jitter,
				retryAfterMs: getRetryAfterMs(error),
			});
			await sleep(delay, signal);
			attempt += 1;
		}
	}
}

function isRetryable(error: unknown): error is RetryableError {
	if (error instanceof RetryableError) {
		return true;
	}
	// Cross-realm safe — if the error happens to come from another realm
	// (e.g. an iframe), the prototype check above misses, so fall back to
	// the discriminator field.
	return (
		error !== null &&
		typeof error === "object" &&
		(error as { name?: unknown }).name === "RetryableError"
	);
}

function getRetryAfterMs(error: unknown): number | undefined {
	if (
		error !== null &&
		typeof error === "object" &&
		typeof (error as { retryAfterMs?: unknown }).retryAfterMs === "number"
	) {
		return (error as { retryAfterMs: number }).retryAfterMs;
	}
	return undefined;
}

function computeDelay(input: {
	readonly attempt: number;
	readonly baseDelayMs: number;
	readonly maxDelayMs: number;
	readonly jitter: () => number;
	readonly retryAfterMs: number | undefined;
}): number {
	if (input.retryAfterMs !== undefined) {
		return Math.max(0, input.retryAfterMs);
	}
	const exp = Math.min(
		input.maxDelayMs,
		input.baseDelayMs * 2 ** input.attempt,
	);
	// Full jitter on the upper half: random between exp/2 and exp.
	const half = exp / 2;
	return Math.floor(half + input.jitter() * half);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) {
		throw makeAbortError(signal);
	}
}

function makeAbortError(signal: AbortSignal): Error {
	const reason = signal.reason;
	if (reason instanceof Error) {
		return reason;
	}
	if (typeof DOMException !== "undefined") {
		return new DOMException("Aborted", "AbortError");
	}
	const error = new Error("Aborted");
	error.name = "AbortError";
	return error;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
	if (ms <= 0) {
		throwIfAborted(signal);
		return Promise.resolve();
	}
	return new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(makeAbortError(signal as AbortSignal));
		};
		if (signal) {
			if (signal.aborted) {
				clearTimeout(timer);
				reject(makeAbortError(signal));
				return;
			}
			signal.addEventListener("abort", onAbort, { once: true });
		}
	});
}
