import { describe, expect, it, vi } from "vitest";

import { RetryableError, withRetry } from "../retry.js";

describe("RetryableError", () => {
	it("captures cause and retryAfterMs", () => {
		const cause = new Error("server down");
		const error = new RetryableError("transient", {
			cause,
			retryAfterMs: 500,
		});
		expect(error.name).toBe("RetryableError");
		expect(error.cause).toBe(cause);
		expect(error.retryAfterMs).toBe(500);
	});
});

describe("withRetry", () => {
	const constantJitter = () => 0;
	const noopSleep = () => Promise.resolve();

	it("returns the first successful value without retry", async () => {
		const fn = vi.fn(async () => "ok");
		const result = await withRetry(fn, {
			jitter: constantJitter,
			sleep: noopSleep,
		});
		expect(result).toBe("ok");
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("retries on RetryableError and returns the eventual success", async () => {
		let attempts = 0;
		const fn = vi.fn(async () => {
			attempts += 1;
			if (attempts < 3) {
				throw new RetryableError("nope");
			}
			return "yes";
		});
		const result = await withRetry(fn, {
			jitter: constantJitter,
			sleep: noopSleep,
		});
		expect(result).toBe("yes");
		expect(fn).toHaveBeenCalledTimes(3);
	});

	it("rethrows immediately on non-retryable errors", async () => {
		const fn = vi.fn(async () => {
			throw new Error("permanent");
		});
		await expect(
			withRetry(fn, { jitter: constantJitter, sleep: noopSleep }),
		).rejects.toThrow("permanent");
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("exhausts retries and rethrows the last RetryableError", async () => {
		const fn = vi.fn(async () => {
			throw new RetryableError("still down");
		});
		await expect(
			withRetry(fn, {
				maxRetries: 2,
				jitter: constantJitter,
				sleep: noopSleep,
			}),
		).rejects.toThrow("still down");
		expect(fn).toHaveBeenCalledTimes(3);
	});

	it("computes exponential backoff with full-jitter on upper half", async () => {
		const sleeps: number[] = [];
		const sleepSpy = (ms: number) => {
			sleeps.push(ms);
			return Promise.resolve();
		};
		const fn = vi
			.fn(async () => {
				throw new RetryableError("boom");
			})
			.mockName("boomFn");
		await expect(
			withRetry(fn, {
				maxRetries: 3,
				baseDelayMs: 100,
				jitter: () => 1, // upper bound of jitter window
				sleep: sleepSpy,
			}),
		).rejects.toThrow("boom");
		// attempt 0 → exp=100, half=50, sleep = 50 + 1*50 = 100
		// attempt 1 → exp=200, half=100, sleep = 100 + 100 = 200
		// attempt 2 → exp=400, half=200, sleep = 200 + 200 = 400
		expect(sleeps).toEqual([100, 200, 400]);
	});

	it("honors retryAfterMs override", async () => {
		const sleeps: number[] = [];
		const sleepSpy = (ms: number) => {
			sleeps.push(ms);
			return Promise.resolve();
		};
		let attempts = 0;
		const fn = async () => {
			attempts += 1;
			if (attempts === 1) {
				throw new RetryableError("slow down", { retryAfterMs: 999 });
			}
			return "ok";
		};
		const result = await withRetry(fn, {
			baseDelayMs: 100,
			jitter: constantJitter,
			sleep: sleepSpy,
		});
		expect(result).toBe("ok");
		expect(sleeps).toEqual([999]);
	});

	it("caps delay at maxDelayMs", async () => {
		const sleeps: number[] = [];
		const sleepSpy = (ms: number) => {
			sleeps.push(ms);
			return Promise.resolve();
		};
		const fn = async () => {
			throw new RetryableError("boom");
		};
		await expect(
			withRetry(fn, {
				maxRetries: 5,
				baseDelayMs: 100,
				maxDelayMs: 250,
				jitter: () => 1,
				sleep: sleepSpy,
			}),
		).rejects.toThrow();
		// after attempt 2 (exp=400) the cap engages → exp = 250, sleep = 125 + 125
		const cappedDelays = sleeps.slice(2);
		for (const d of cappedDelays) {
			expect(d).toBeLessThanOrEqual(250);
		}
	});

	it("aborts before the first call when signal is already aborted", async () => {
		const fn = vi.fn(async () => "should not run");
		const controller = new AbortController();
		controller.abort();
		await expect(
			withRetry(fn, { signal: controller.signal, sleep: noopSleep }),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(fn).not.toHaveBeenCalled();
	});

	it("aborts during retry sleep", async () => {
		const fn = vi.fn(async () => {
			throw new RetryableError("nope");
		});
		const controller = new AbortController();
		// Use the real sleep helper; abort mid-sleep.
		const promise = withRetry(fn, {
			maxRetries: 5,
			baseDelayMs: 1000,
			signal: controller.signal,
		});
		// Tick to enter sleep, then abort.
		queueMicrotask(() => controller.abort());
		await expect(promise).rejects.toMatchObject({ name: "AbortError" });
	});

	it("aborts between attempts when signal flips after a failure", async () => {
		const controller = new AbortController();
		const fn = vi.fn(async () => {
			controller.abort();
			throw new RetryableError("retry me");
		});
		await expect(
			withRetry(fn, {
				maxRetries: 5,
				signal: controller.signal,
				sleep: noopSleep,
			}),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("treats cross-realm RetryableError-shaped errors as retryable", async () => {
		let attempts = 0;
		const fn = async () => {
			attempts += 1;
			if (attempts === 1) {
				const err = new Error("cross-realm");
				err.name = "RetryableError";
				throw err;
			}
			return "ok";
		};
		await expect(
			withRetry(fn, { jitter: constantJitter, sleep: noopSleep }),
		).resolves.toBe("ok");
	});
});
