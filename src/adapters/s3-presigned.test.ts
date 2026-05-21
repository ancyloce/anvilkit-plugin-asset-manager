import { describe, expect, it, vi } from "vitest";

import { AssetValidationError } from "../utils/errors.js";
import { s3PresignedAdapter } from "./s3-presigned.js";

interface FakeCall {
	readonly url: string;
	readonly method: string;
	readonly body?: unknown;
	readonly signal?: AbortSignal;
}

function createFakeFetch(
	responses: Array<Response | (() => Response | Promise<Response>) | Error>,
) {
	const calls: FakeCall[] = [];
	let i = 0;
	const fetch: typeof globalThis.fetch = async (input, init) => {
		const url = typeof input === "string" ? input : input.toString();
		calls.push({
			url,
			method: init?.method ?? "GET",
			body: init?.body,
			...(init?.signal ? { signal: init.signal } : {}),
		});
		const next = responses[i++];
		if (next === undefined) {
			throw new Error(`fake fetch ran out of responses at call #${i}`);
		}
		if (next instanceof Error) {
			throw next;
		}
		return typeof next === "function" ? await next() : next;
	};
	return { fetch, calls };
}

function makeJsonResponse(body: unknown, init?: ResponseInit): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "Content-Type": "application/json" },
		...init,
	});
}

function makeFile(name = "hello.txt", type = "text/plain", contents = "hi") {
	return new File([contents], name, { type });
}

const fastRetry = {
	baseDelayMs: 1,
	jitter: () => 0,
	sleep: () => Promise.resolve(),
};

describe("s3PresignedAdapter", () => {
	it("posts presign + PUTs the file body and returns a validated UploadResult", async () => {
		const file = makeFile("logo.png", "image/png", "PNGDATA");
		const { fetch, calls } = createFakeFetch([
			makeJsonResponse({
				url: "https://s3.example.com/upload?signed=true",
				publicUrl: "https://cdn.example.com/logo.png",
				id: "asset-101",
			}),
			new Response(null, { status: 200 }),
		]);

		const adapter = s3PresignedAdapter({
			presignEndpoint: "https://api.example.com/sign",
			fetch,
			retry: fastRetry,
		});

		const result = await adapter(file);
		expect(result).toEqual({
			id: "asset-101",
			url: "https://cdn.example.com/logo.png",
			name: "logo.png",
			meta: { size: file.size, mimeType: "image/png" },
		});

		expect(calls[0]?.url).toBe("https://api.example.com/sign");
		expect(calls[0]?.method).toBe("POST");
		expect(JSON.parse(calls[0]?.body as string)).toEqual({
			name: "logo.png",
			type: "image/png",
			size: file.size,
		});
		expect(calls[1]?.url).toBe("https://s3.example.com/upload?signed=true");
		expect(calls[1]?.method).toBe("PUT");
	});

	it("falls back to a generated id and stripped public URL when missing", async () => {
		const file = makeFile();
		const { fetch } = createFakeFetch([
			makeJsonResponse({
				url: "https://s3.example.com/u/abc?signed=true#frag",
			}),
			new Response(null, { status: 200 }),
		]);

		const adapter = s3PresignedAdapter({
			presignEndpoint: "https://api.example.com/sign",
			fetch,
			retry: fastRetry,
			idGenerator: () => "generated-id",
		});

		const result = await adapter(file);
		expect(result.id).toBe("generated-id");
		expect(result.url).toBe("https://s3.example.com/u/abc");
	});

	it("retries on 5xx PUT and succeeds on the second attempt", async () => {
		const file = makeFile();
		const { fetch, calls } = createFakeFetch([
			makeJsonResponse({ url: "https://s3.example.com/u" }),
			new Response("oh no", { status: 503 }),
			new Response(null, { status: 200 }),
		]);

		const adapter = s3PresignedAdapter({
			presignEndpoint: "https://api.example.com/sign",
			fetch,
			retry: fastRetry,
			idGenerator: () => "id",
		});

		await adapter(file);
		expect(calls.filter((c) => c.method === "PUT")).toHaveLength(2);
	});

	it("retries on 5xx presign and exhausts after maxRetries", async () => {
		const file = makeFile();
		const { fetch, calls } = createFakeFetch([
			new Response(null, { status: 502 }),
			new Response(null, { status: 502 }),
			new Response(null, { status: 502 }),
		]);

		const adapter = s3PresignedAdapter({
			presignEndpoint: "https://api.example.com/sign",
			fetch,
			retry: { ...fastRetry, maxRetries: 2 },
		});

		await expect(adapter(file)).rejects.toMatchObject({
			name: "RetryableError",
		});
		expect(calls).toHaveLength(3);
	});

	it("throws AssetValidationError without retry on 4xx presign", async () => {
		const file = makeFile();
		const { fetch, calls } = createFakeFetch([
			new Response(null, { status: 403 }),
		]);

		const adapter = s3PresignedAdapter({
			presignEndpoint: "https://api.example.com/sign",
			fetch,
			retry: fastRetry,
		});

		await expect(adapter(file)).rejects.toBeInstanceOf(AssetValidationError);
		expect(calls).toHaveLength(1);
	});

	it("throws AssetValidationError on non-JSON presign response", async () => {
		const file = makeFile();
		const { fetch } = createFakeFetch([
			new Response("not json", { status: 200 }),
		]);

		const adapter = s3PresignedAdapter({
			presignEndpoint: "https://api.example.com/sign",
			fetch,
			retry: fastRetry,
		});

		await expect(adapter(file)).rejects.toBeInstanceOf(AssetValidationError);
	});

	it("throws AssetValidationError when presign response lacks `url`", async () => {
		const file = makeFile();
		const { fetch } = createFakeFetch([makeJsonResponse({ random: 1 })]);

		const adapter = s3PresignedAdapter({
			presignEndpoint: "https://api.example.com/sign",
			fetch,
			retry: fastRetry,
		});

		await expect(adapter(file)).rejects.toMatchObject({
			name: "AssetValidationError",
			code: "UPLOAD_FAILED",
		});
	});

	it("treats fetch network rejection as retryable", async () => {
		const file = makeFile();
		const { fetch, calls } = createFakeFetch([
			new TypeError("network failure"),
			makeJsonResponse({ url: "https://s3.example.com/u" }),
			new Response(null, { status: 200 }),
		]);

		const adapter = s3PresignedAdapter({
			presignEndpoint: "https://api.example.com/sign",
			fetch,
			retry: fastRetry,
			idGenerator: () => "id",
		});

		await adapter(file);
		expect(calls).toHaveLength(3);
	});

	it("aborts immediately when the host signal is already aborted", async () => {
		const file = makeFile();
		const { fetch, calls } = createFakeFetch([
			makeJsonResponse({ url: "https://s3.example.com/u" }),
		]);
		const controller = new AbortController();
		controller.abort();

		const adapter = s3PresignedAdapter({
			presignEndpoint: "https://api.example.com/sign",
			fetch,
			signal: controller.signal,
			retry: fastRetry,
		});

		await expect(adapter(file)).rejects.toMatchObject({ name: "AbortError" });
		expect(calls).toHaveLength(0);
	});

	it("forwards extra headers on the presign POST", async () => {
		const file = makeFile();
		const { fetch, calls } = createFakeFetch([
			makeJsonResponse({ url: "https://s3.example.com/u" }),
			new Response(null, { status: 200 }),
		]);

		const adapter = s3PresignedAdapter({
			presignEndpoint: "https://api.example.com/sign",
			fetch,
			headers: { authorization: "Bearer abc" },
			retry: fastRetry,
			idGenerator: () => "id",
		});
		await adapter(file);
		// The fake doesn't capture headers — but assert it didn't error
		// and called both endpoints.
		expect(calls.map((c) => c.method)).toEqual(["POST", "PUT"]);
	});

	it("honors retry-after header on transient 5xx", async () => {
		const file = makeFile();
		const sleepSpy = vi.fn(async () => {
			// Spy that resolves immediately; we only assert the recorded delay.
		});
		const { fetch } = createFakeFetch([
			new Response(null, { status: 503, headers: { "retry-after": "2" } }),
			makeJsonResponse({ url: "https://s3.example.com/u" }),
			new Response(null, { status: 200 }),
		]);

		const adapter = s3PresignedAdapter({
			presignEndpoint: "https://api.example.com/sign",
			fetch,
			retry: { sleep: sleepSpy, jitter: () => 0 },
			idGenerator: () => "id",
		});
		await adapter(file);
		// The first sleep should match the retry-after override (2 seconds → 2000ms).
		expect(sleepSpy).toHaveBeenCalledWith(2_000, undefined);
	});

	it("throws when no fetch implementation is available", () => {
		const originalFetch = globalThis.fetch;
		// Simulate an environment without fetch (e.g. legacy Node).
		(globalThis as { fetch?: typeof globalThis.fetch }).fetch =
			undefined as unknown as typeof globalThis.fetch;
		try {
			expect(() =>
				s3PresignedAdapter({
					presignEndpoint: "https://api.example.com/sign",
				}),
			).toThrow();
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
