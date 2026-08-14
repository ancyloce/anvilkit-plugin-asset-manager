import { describe, expect, it, vi } from "vitest";

import {
	createUnsplashProvider,
	UNSPLASH_THEME_FACET,
	unsplashEnabled,
} from "../sources/unsplash/index.js";

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
	width: 4000,
	height: 3000,
	description: "A mountain",
	urls: {
		regular: "https://images.unsplash.com/photo-1?ixid=abc",
		small: "https://images.unsplash.com/photo-1-small",
		thumb: "https://images.unsplash.com/photo-1-thumb",
	},
	links: {
		html: "https://unsplash.com/photos/p1",
		download_location: "https://api.unsplash.com/photos/p1/download",
	},
	user: { name: "Jane Doe", links: { html: "https://unsplash.com/@jane" } },
};

function routingFetch() {
	return vi.fn(async (url: unknown) => {
		const u = String(url);
		if (u.includes("/search/photos"))
			return makeResponse(200, { total: 100, results: [photo] });
		if (u.includes("/topics/")) return makeResponse(200, [photo]);
		if (u.includes("/download")) return makeResponse(200, {});
		if (u.includes("/photos/")) return makeResponse(200, photo); // getPhoto by id
		return makeResponse(200, {});
	});
}

function rehostRoutingFetch(imageStatus = 200) {
	return vi.fn(async (url: unknown) => {
		const u = String(url);
		if (u.startsWith("https://images.unsplash.com/")) {
			return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
				status: imageStatus,
				headers: { "content-type": "image/jpeg" },
			});
		}
		if (u.includes("/search/photos"))
			return makeResponse(200, { total: 100, results: [photo] });
		if (u.includes("/download")) return makeResponse(200, {});
		if (u.includes("/photos/")) return makeResponse(200, photo);
		return makeResponse(200, {});
	});
}

describe("unsplashEnabled", () => {
	it("is enabled with a key or proxy, disabled bare, and respects `enabled`", () => {
		expect(unsplashEnabled({ appName: "d", accessKey: "K" })).toBe(true);
		expect(unsplashEnabled({ appName: "d", proxyEndpoint: "/p" })).toBe(true);
		expect(unsplashEnabled({ appName: "d" })).toBe(false);
		expect(unsplashEnabled({ appName: "d", enabled: true })).toBe(true);
		expect(
			unsplashEnabled({ appName: "d", accessKey: "K", enabled: false }),
		).toBe(false);
	});
});

describe("createUnsplashProvider — search projection", () => {
	it("maps photos to hotlinked UploadResults with UTM attribution", async () => {
		const fetchMock = routingFetch();
		const provider = createUnsplashProvider({
			appName: "demo",
			accessKey: "K",
			fetch: fetchMock,
		});
		const page = await provider.search({ query: "mountains" }, undefined);
		const item = page.items[0];
		expect(item?.id).toBe("unsplash:p1");
		expect(item?.url).toBe("https://images.unsplash.com/photo-1?ixid=abc"); // hotlink, ixid preserved
		expect(item?.meta?.mimeType).toBe("image/jpeg");
		expect(item?.meta?.attribution?.photographerName).toBe("Jane Doe");
		expect(item?.meta?.attribution?.photographerUrl).toContain(
			"utm_source=demo",
		);
		expect(item?.meta?.attribution?.downloadLocation).toBe(
			"https://api.unsplash.com/photos/p1/download",
		);
		expect(page.total).toBe(100);
	});

	it("uses the topics endpoint for a themed query with no free text", async () => {
		const fetchMock = routingFetch();
		const provider = createUnsplashProvider({
			appName: "demo",
			accessKey: "K",
			fetch: fetchMock,
			themes: { defaultThemeId: "nature", allowFreeSearch: false },
		});
		await provider.search({}, undefined);
		expect(
			fetchMock.mock.calls.some((c) =>
				String(c[0]).includes("/topics/nature/photos"),
			),
		).toBe(true);
	});

	it("routes a per-request facet (filter.facets[unsplash:theme]) to that theme's topic", async () => {
		// The remote-facet delegation path: a theme selected at query time via
		// AssetFilter.facets (not just the configured defaultThemeId) must drive
		// the topic endpoint (PRD 0002 §9 — facets match remote).
		const fetchMock = routingFetch();
		const provider = createUnsplashProvider({
			appName: "demo",
			accessKey: "K",
			fetch: fetchMock,
			themes: {
				themes: [
					{ id: "business", label: "Business", topicSlugs: ["business"] },
				],
				allowFreeSearch: false,
			},
		});
		await provider.search(
			{ facets: { [UNSPLASH_THEME_FACET]: ["business"] } },
			undefined,
		);
		expect(
			fetchMock.mock.calls.some((c) =>
				String(c[0]).includes("/topics/business/photos"),
			),
		).toBe(true);
	});

	it("caches identical queries (one network call)", async () => {
		const fetchMock = routingFetch();
		const provider = createUnsplashProvider({
			appName: "demo",
			accessKey: "K",
			fetch: fetchMock,
		});
		await provider.search({ query: "x" }, undefined);
		await provider.search({ query: "x" }, undefined);
		const searchCalls = fetchMock.mock.calls.filter((c) =>
			String(c[0]).includes("/search/photos"),
		);
		expect(searchCalls).toHaveLength(1);
	});

	it("propagates a 429 as PROVIDER_RATE_LIMITED", async () => {
		const fetchMock = vi.fn(async () =>
			makeResponse(429, {}, { "retry-after": "10" }),
		);
		const provider = createUnsplashProvider({
			appName: "demo",
			accessKey: "K",
			fetch: fetchMock,
		});
		await expect(
			provider.search({ query: "x" }, undefined),
		).rejects.toMatchObject({ code: "PROVIDER_RATE_LIMITED", retryable: true });
	});
});

describe("createUnsplashProvider — pickResult", () => {
	it("fires the mandatory download trigger and returns the hotlinked result", async () => {
		const fetchMock = routingFetch();
		const ingest = vi.fn(async () => ({ id: "local-p1", url: "local-url" }));
		const provider = createUnsplashProvider(
			{
				appName: "demo",
				accessKey: "K",
				fetch: fetchMock,
			},
			ingest,
		);
		await provider.search({ query: "mountains" }, undefined); // populates the byId cache
		const result = await provider.pickResult({
			id: "unsplash:p1",
			kind: "image",
			name: "A mountain",
			url: "asset://unsplash:p1",
		});
		expect(result.url).toBe("https://images.unsplash.com/photo-1?ixid=abc");
		expect(
			fetchMock.mock.calls.some(
				(c) => c[0] === "https://api.unsplash.com/photos/p1/download",
			),
		).toBe(true);
		expect(ingest).not.toHaveBeenCalled();
	});

	it("rehosts through ingest while preserving attribution and tracking", async () => {
		const fetchMock = rehostRoutingFetch();
		const ingest = vi.fn(async (file: File) => ({
			id: "local-p1",
			url: "https://cdn.example/local-p1.jpg",
			name: file.name,
			meta: { size: file.size, mimeType: file.type },
		}));
		const provider = createUnsplashProvider(
			{
				appName: "demo",
				accessKey: "K",
				fetch: fetchMock,
				rehostOnPick: true,
			},
			ingest,
		);
		await provider.search({ query: "mountains" }, undefined);

		const result = await provider.pickResult({
			id: "unsplash:p1",
			kind: "image",
			name: "A mountain",
			url: "asset://unsplash:p1",
		});

		expect(ingest).toHaveBeenCalledOnce();
		const file = ingest.mock.calls[0]?.[0];
		expect(file).toBeInstanceOf(File);
		expect(file?.name).toBe("unsplash-p1.jpg");
		expect(file?.type).toBe("image/jpeg");
		expect(result).toMatchObject({
			id: "local-p1",
			url: "https://cdn.example/local-p1.jpg",
			name: "A mountain",
			meta: {
				width: 4000,
				height: 3000,
				mimeType: "image/jpeg",
				attribution: {
					source: "unsplash",
					photographerName: "Jane Doe",
				},
			},
		});
		expect(
			fetchMock.mock.calls.some(
				([url]) => url === "https://api.unsplash.com/photos/p1/download",
			),
		).toBe(true);
		expect(provider.requiredCsp?.().connectSrc).toContain(
			"https://images.unsplash.com",
		);
	});

	it("surfaces image download failure without invoking ingest", async () => {
		const fetchMock = rehostRoutingFetch(502);
		const ingest = vi.fn(async () => ({ id: "local-p1", url: "local-url" }));
		const provider = createUnsplashProvider(
			{
				appName: "demo",
				accessKey: "K",
				fetch: fetchMock,
				rehostOnPick: true,
			},
			ingest,
		);
		await provider.search({ query: "mountains" }, undefined);

		await expect(
			provider.pickResult({
				id: "unsplash:p1",
				kind: "image",
				name: "A mountain",
				url: "asset://unsplash:p1",
			}),
		).rejects.toMatchObject({
			code: "PROVIDER_BAD_RESPONSE",
			status: 502,
			retryable: true,
		});
		expect(ingest).not.toHaveBeenCalled();
	});

	it("honors an aborted pick before tracking, downloading, or ingesting", async () => {
		const fetchMock = rehostRoutingFetch();
		const ingest = vi.fn(async () => ({ id: "local-p1", url: "local-url" }));
		const provider = createUnsplashProvider(
			{
				appName: "demo",
				accessKey: "K",
				fetch: fetchMock,
				rehostOnPick: true,
			},
			ingest,
		);
		await provider.search({ query: "mountains" }, undefined);
		const controller = new AbortController();
		controller.abort();
		const callsBeforePick = fetchMock.mock.calls.length;

		await expect(
			provider.pickResult(
				{
					id: "unsplash:p1",
					kind: "image",
					name: "A mountain",
					url: "asset://unsplash:p1",
				},
				controller.signal,
			),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(fetchMock.mock.calls).toHaveLength(callsBeforePick);
		expect(ingest).not.toHaveBeenCalled();
	});

	it("refetches + fires the trigger on a cache miss (provider recreated)", async () => {
		const fetchMock = routingFetch();
		const provider = createUnsplashProvider({
			appName: "demo",
			accessKey: "K",
			fetch: fetchMock,
		});
		// No preceding search → byId is empty, as after a page reload.
		const result = await provider.pickResult({
			id: "unsplash:p1",
			kind: "image",
			name: "A mountain",
			url: "asset://unsplash:p1",
		});
		expect(result.url).toBe("https://images.unsplash.com/photo-1?ixid=abc");
		expect(result.meta?.attribution?.downloadLocation).toBe(
			"https://api.unsplash.com/photos/p1/download",
		);
		expect(
			fetchMock.mock.calls.some((c) => /\/photos\/p1$/.test(String(c[0]))),
		).toBe(true);
		expect(
			fetchMock.mock.calls.some(
				(c) => c[0] === "https://api.unsplash.com/photos/p1/download",
			),
		).toBe(true);
	});

	it("reports a failed download trigger without blocking the pick", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const fetchMock = vi.fn(async (url: unknown) => {
			if (String(url).includes("/download")) return makeResponse(503, {});
			return makeResponse(200, { total: 1, results: [photo] });
		});
		const provider = createUnsplashProvider({
			appName: "demo",
			proxyEndpoint: "/api/unsplash",
			fetch: fetchMock,
		});
		await provider.search({ query: "mountains" }, undefined);

		await expect(
			provider.pickResult({
				id: "unsplash:p1",
				kind: "image",
				name: "A mountain",
				url: "asset://unsplash:p1",
			}),
		).resolves.toMatchObject({ id: "unsplash:p1" });
		await vi.waitFor(() => {
			expect(warn).toHaveBeenCalledWith(
				"asset-manager: Unsplash download tracking failed.",
				expect.objectContaining({
					code: "PROVIDER_BAD_RESPONSE",
					status: 503,
				}),
			);
		});
		warn.mockRestore();
	});

	it("exposes Unsplash capabilities (read-only, themed, attribution-required)", () => {
		const provider = createUnsplashProvider({ appName: "d", accessKey: "K" });
		expect(provider.capabilities).toMatchObject({
			searchable: true,
			themed: true,
			mutable: false,
			requiresAttribution: true,
			folders: false,
		});
		expect(provider.requiredCsp?.().imgSrc).toContain(
			"https://images.unsplash.com",
		);
	});
});
