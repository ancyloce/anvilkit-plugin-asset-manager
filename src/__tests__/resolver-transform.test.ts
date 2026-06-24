import type { PageIR } from "@anvilkit/core/types";
import { describe, expect, it, vi } from "vitest";

import { createAssetReference } from "../utils/asset-reference.js";
import { AssetResolutionError } from "../utils/errors.js";
import { createAssetRegistry } from "../utils/registry.js";
import { createIRAssetResolver, resolveAssets } from "../utils/resolver.js";

function registryWithA1() {
	const registry = createAssetRegistry();
	registry.register({ id: "a1", url: "https://cdn.example/a1.png" });
	return registry;
}

describe("createIRAssetResolver — transforms", () => {
	it("applies the transformResolver to a transform-bearing reference", () => {
		const transformResolver = vi.fn(
			(asset, t) =>
				`https://cdn.example/${asset.id}?w=${t.width}&fm=${t.format}`,
		);
		const resolver = createIRAssetResolver({
			registry: registryWithA1(),
			transformResolver,
		});

		const res = resolver(
			createAssetReference("a1", { width: 400, format: "webp" }),
		);
		expect(res?.url).toBe("https://cdn.example/a1?w=400&fm=webp");
		expect(transformResolver).toHaveBeenCalledWith(
			expect.objectContaining({ id: "a1" }),
			{ width: 400, format: "webp" },
		);
	});

	it("uses the original URL when the reference carries no transform", () => {
		const transformResolver = vi.fn();
		const resolver = createIRAssetResolver({
			registry: registryWithA1(),
			transformResolver,
		});

		const res = resolver(createAssetReference("a1"));
		expect(res?.url).toBe("https://cdn.example/a1.png");
		expect(transformResolver).not.toHaveBeenCalled();
	});

	it("falls back to the original URL when the resolver returns undefined", () => {
		const resolver = createIRAssetResolver({
			registry: registryWithA1(),
			transformResolver: () => undefined,
		});
		expect(resolver(createAssetReference("a1", { width: 400 }))?.url).toBe(
			"https://cdn.example/a1.png",
		);
	});

	it("uses the original URL when no transformResolver is configured", () => {
		const resolver = createIRAssetResolver({ registry: registryWithA1() });
		expect(resolver(createAssetReference("a1", { width: 400 }))?.url).toBe(
			"https://cdn.example/a1.png",
		);
	});

	it("re-validates the derivative URL (hostile derivative rejected)", () => {
		const resolver = createIRAssetResolver({
			registry: registryWithA1(),
			transformResolver: () => "javascript:alert(1)",
		});
		let caught: unknown;
		try {
			resolver(createAssetReference("a1", { width: 400 }));
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(AssetResolutionError);
		expect((caught as AssetResolutionError).code).toBe("ASSET_URL_REJECTED");
	});

	it("maps a throwing transformResolver to AssetResolutionError", () => {
		const resolver = createIRAssetResolver({
			registry: registryWithA1(),
			transformResolver: () => {
				throw new Error("transform backend down");
			},
		});
		expect(() => resolver(createAssetReference("a1", { width: 400 }))).toThrow(
			AssetResolutionError,
		);
	});

	it("drops stale dimensional meta on a derivative but keeps attribution", () => {
		const registry = createAssetRegistry();
		const attribution = {
			source: "unsplash" as const,
			photographerName: "Jane Doe",
			photographerUrl: "https://unsplash.com/@jane",
			unsplashUrl: "https://unsplash.com/?utm_source=demo",
			photoUrl: "https://images.unsplash.com/p1",
			downloadLocation: "https://api.unsplash.com/photos/1/download",
		};
		registry.register({
			id: "u1",
			url: "https://images.unsplash.com/p1",
			meta: { width: 4000, height: 3000, attribution },
		});
		const resolver = createIRAssetResolver({
			registry,
			transformResolver: () => "https://cdn.example/u1?w=400",
		});
		const res = resolver(createAssetReference("u1", { width: 400 }));
		expect(res?.meta).toEqual({ attribution });
		expect(
			(res?.meta as { width?: number } | undefined)?.width,
		).toBeUndefined();
	});

	it("resolves distinct transforms independently through resolveAssets", async () => {
		const registry = registryWithA1();
		const resolver = createIRAssetResolver({
			registry,
			transformResolver: (_a, t) => `https://cdn.example/a1?w=${t.width}`,
		});
		const ir: PageIR = {
			version: "1",
			root: {
				id: "root",
				type: "__root__",
				props: {
					imageSrc: createAssetReference("a1", { width: 100 }),
					poster: createAssetReference("a1", { width: 200 }),
				},
			},
			assets: [],
			metadata: {},
		};
		const resolved = await resolveAssets(ir, resolver);
		const props = resolved.root.props as { imageSrc: string; poster: string };
		expect(props.imageSrc).toBe("https://cdn.example/a1?w=100");
		expect(props.poster).toBe("https://cdn.example/a1?w=200");
	});
});
