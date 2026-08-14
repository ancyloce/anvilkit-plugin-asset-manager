import {
	createFakeStudioContext,
	registerPlugin,
} from "@anvilkit/core/testing";
import type {
	StudioAssetSource,
	StudioPluginContext,
} from "@anvilkit/core/types";
import { describe, expect, it, vi } from "vitest";

import { createAssetManagerPlugin, getAssetRegistry } from "../plugin.js";

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

function responseJson(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

describe("Unsplash rehostOnPick plugin wiring", () => {
	it("ingests a picked photo as a local, resolvable asset with attribution", async () => {
		const fetchMock = vi.fn(async (url: unknown) => {
			const value = String(url);
			if (value.startsWith("https://images.unsplash.com/")) {
				return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
					status: 200,
					headers: { "content-type": "image/jpeg" },
				});
			}
			if (value.endsWith("/download")) return responseJson({});
			if (value.endsWith("/photos/p1")) return responseJson(photo);
			return responseJson({ total: 1, results: [photo] });
		});
		const uploader = vi.fn(async (file: File) => ({
			id: "local-p1",
			url: "https://cdn.example/local-p1.jpg",
			name: file.name,
		}));
		const registeredSources: StudioAssetSource[] = [];
		const base = createFakeStudioContext();
		const ctx = {
			...base,
			registerAssetSource(source: StudioAssetSource) {
				registeredSources.push(source);
				return () => undefined;
			},
		} as StudioPluginContext;
		const plugin = createAssetManagerPlugin({
			uploader,
			unsplash: {
				appName: "demo",
				accessKey: "K",
				fetch: fetchMock,
				rehostOnPick: true,
			},
		});
		const harness = await registerPlugin(plugin, { ctx });
		await harness.runInit();
		await vi.waitFor(() => expect(registeredSources).toHaveLength(2));
		const source = registeredSources.at(-1);

		const picked = await source?.pickResult?.({
			id: "unsplash:p1",
			kind: "image",
			name: "A mountain",
			url: "https://images.unsplash.com/photo-1?ixid=abc",
			source: "unsplash",
		});

		expect(uploader).toHaveBeenCalledOnce();
		expect(picked).toMatchObject({
			id: "local-p1",
			url: "asset://local-p1",
			source: "local",
			attribution: { photographerName: "Jane Doe" },
		});
		const stored = getAssetRegistry(ctx)?.get("local-p1");
		expect(stored?.url).toBe("https://cdn.example/local-p1.jpg");
		expect(stored?.meta?.attribution?.photographerName).toBe("Jane Doe");
		expect(
			fetchMock.mock.calls.some(
				([url]) => url === "https://api.unsplash.com/photos/p1/download",
			),
		).toBe(true);

		await harness.runDestroy();
	});
});
