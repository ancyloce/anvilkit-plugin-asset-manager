import { describe, expect, it, vi } from "vitest";

import { createUnsplashClient } from "../sources/unsplash/client.js";
import { AssetSourceError } from "../utils/errors.js";

function makeResponse(
	status: number,
	body: unknown,
	headers: Record<string, string> = {},
): Response {
	const lower = Object.fromEntries(
		Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
	);
	return {
		ok: status >= 200 && status < 300,
		status,
		headers: { get: (k: string) => lower[k.toLowerCase()] ?? null },
		json: async () => body,
	} as unknown as Response;
}

const photo = {
	id: "p1",
	urls: { regular: "https://images.unsplash.com/r", small: "s", thumb: "t" },
	links: {
		html: "h",
		download_location: "https://api.unsplash.com/photos/p1/download",
	},
	user: { name: "Jane", links: { html: "u" } },
};

describe("createUnsplashClient — requests & auth", () => {
	it("sends a Client-ID header and the search params (direct mode)", async () => {
		const fetchMock = vi.fn(async () =>
			makeResponse(200, { total: 1, results: [photo] }),
		);
		const client = createUnsplashClient({ accessKey: "KEY", fetch: fetchMock });
		const result = await client.searchPhotos({
			query: "mountains",
			perPage: 24,
			contentFilter: "high",
		});
		expect(result.total).toBe(1);
		expect(result.results[0]?.id).toBe("p1");
		const [url, init] = fetchMock.mock.calls[0] ?? [];
		expect(String(url)).toContain("https://api.unsplash.com/search/photos");
		expect(String(url)).toContain("query=mountains");
		expect(String(url)).toContain("per_page=24");
		expect((init as RequestInit).headers).toMatchObject({
			Authorization: "Client-ID KEY",
		});
	});

	it("omits the auth header and uses the proxy base (relative proxy works)", async () => {
		const fetchMock = vi.fn(async () => makeResponse(200, { results: [] }));
		const client = createUnsplashClient({
			proxyEndpoint: "/api/unsplash",
			accessKey: "IGNORED",
			fetch: fetchMock,
		});
		await client.searchPhotos({ query: "x" });
		const [url, init] = fetchMock.mock.calls[0] ?? [];
		expect(String(url)).toMatch(/^\/api\/unsplash\/search\/photos\?/);
		expect((init as RequestInit).headers).not.toHaveProperty("Authorization");
	});
});

describe("createUnsplashClient — error mapping", () => {
	it("maps 429 to PROVIDER_RATE_LIMITED with retryAfterMs", async () => {
		const fetchMock = vi.fn(async () =>
			makeResponse(429, {}, { "retry-after": "38" }),
		);
		const client = createUnsplashClient({ accessKey: "K", fetch: fetchMock });
		await expect(client.searchPhotos({ query: "x" })).rejects.toMatchObject({
			code: "PROVIDER_RATE_LIMITED",
			retryable: true,
			status: 429,
			retryAfterMs: 38_000,
		});
	});

	it("maps 401/403 to PROVIDER_UNAUTHORIZED (not retryable)", async () => {
		const fetchMock = vi.fn(async () => makeResponse(401, {}));
		const client = createUnsplashClient({ accessKey: "K", fetch: fetchMock });
		await expect(client.searchPhotos({ query: "x" })).rejects.toMatchObject({
			code: "PROVIDER_UNAUTHORIZED",
			retryable: false,
		});
	});

	it("maps a thrown fetch to PROVIDER_NETWORK", async () => {
		const fetchMock = vi.fn(async () => {
			throw new TypeError("Failed to fetch");
		});
		const client = createUnsplashClient({ accessKey: "K", fetch: fetchMock });
		const error = await client.searchPhotos({ query: "x" }).catch((e) => e);
		expect(error).toBeInstanceOf(AssetSourceError);
		expect(error.code).toBe("PROVIDER_NETWORK");
	});

	it("re-throws AbortError untouched", async () => {
		const fetchMock = vi.fn(async () => {
			const e = new Error("aborted");
			e.name = "AbortError";
			throw e;
		});
		const client = createUnsplashClient({ accessKey: "K", fetch: fetchMock });
		await expect(client.searchPhotos({ query: "x" })).rejects.toMatchObject({
			name: "AbortError",
		});
	});

	it("maps unreadable JSON to PROVIDER_BAD_RESPONSE", async () => {
		const fetchMock = vi.fn(
			async () =>
				({
					ok: true,
					status: 200,
					headers: { get: () => null },
					json: async () => {
						throw new SyntaxError("bad json");
					},
				}) as unknown as Response,
		);
		const client = createUnsplashClient({ accessKey: "K", fetch: fetchMock });
		await expect(client.searchPhotos({ query: "x" })).rejects.toMatchObject({
			code: "PROVIDER_BAD_RESPONSE",
		});
	});
});

describe("createUnsplashClient — trackDownload", () => {
	it("fires the download trigger and never throws", async () => {
		const fetchMock = vi.fn(async () => makeResponse(200, {}));
		const client = createUnsplashClient({ accessKey: "K", fetch: fetchMock });
		await expect(
			client.trackDownload("https://api.unsplash.com/photos/p1/download"),
		).resolves.toBeUndefined();
		expect(fetchMock).toHaveBeenCalledWith(
			"https://api.unsplash.com/photos/p1/download",
			expect.anything(),
		);
	});

	it("swallows download-trigger failures", async () => {
		const fetchMock = vi.fn(async () => {
			throw new Error("boom");
		});
		const client = createUnsplashClient({ accessKey: "K", fetch: fetchMock });
		await expect(client.trackDownload("https://x/d")).resolves.toBeUndefined();
	});
});
