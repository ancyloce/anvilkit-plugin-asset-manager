import type { PageIR } from "@anvilkit/core/types";
import { describe, expect, it } from "vitest";

import { AssetResolutionError } from "../errors.js";
import { createAssetRegistry } from "../registry.js";
import { createIRAssetResolver, resolveAssets } from "../resolver.js";

function createIr(url: string): PageIR {
	return {
		version: "1",
		root: {
			id: "root",
			type: "__root__",
			props: {},
			children: [
				{
					id: "blog-1",
					type: "BlogList",
					props: {
						posts: [
							{
								title: "Post",
								description: "Ship safely.",
								imageSrc: url,
								imageAlt: "Upload",
							},
						],
					},
				},
			],
		},
		assets: [{ id: "asset-1", kind: "image", url }],
		metadata: {},
	};
}

describe("createIRAssetResolver", () => {
	it("returns null for non-asset URLs", async () => {
		const resolver = createIRAssetResolver({ registry: createAssetRegistry() });
		expect(resolver("https://cdn.example.com/a.png")).toBeNull();
	});

	it("resolves asset:// ids through the registry", async () => {
		const registry = createAssetRegistry();
		registry.register({
			id: "asset-1",
			url: "https://cdn.example.com/a.png",
			meta: { mimeType: "image/png", width: 640 },
		});
		const resolver = createIRAssetResolver({ registry });

		expect(resolver("asset://asset-1")).toEqual({
			url: "https://cdn.example.com/a.png",
			meta: { mimeType: "image/png", width: 640 },
		});
	});

	it("throws AssetResolutionError when the asset is missing", async () => {
		const resolver = createIRAssetResolver({ registry: createAssetRegistry() });

		expect(() => resolver("asset://missing")).toThrowError(
			expect.objectContaining({
				name: "AssetResolutionError",
				assetId: "missing",
			}),
		);
	});

	it("rejects hostile resolved URLs with AssetResolutionError", async () => {
		const registry = createAssetRegistry();
		registry.register({
			id: "asset-hostile",
			url: "javascript:alert(1)",
			meta: { mimeType: "image/png" },
		});
		const resolver = createIRAssetResolver({ registry });

		expect(() => resolver("asset://asset-hostile")).toThrowError(
			AssetResolutionError,
		);
	});
});

describe("resolveAssets", () => {
	it("rewrites asset URLs without mutating the input IR", async () => {
		const registry = createAssetRegistry();
		registry.register({
			id: "asset-1",
			url: "https://cdn.example.com/a.png",
			meta: { mimeType: "image/png", width: 640 },
		});
		const resolver = createIRAssetResolver({ registry });
		const ir = createIr("asset://asset-1");

		const nextIr = await resolveAssets(ir, resolver);

		expect(ir).not.toBe(nextIr);
		expect(ir.assets[0]?.url).toBe("asset://asset-1");
		expect(
			(
				ir.root.children?.[0]?.props.posts as ReadonlyArray<
					Readonly<Record<string, unknown>>
				>
			)[0]?.imageSrc,
		).toBe("asset://asset-1");
		expect(nextIr.assets[0]).toMatchObject({
			url: "https://cdn.example.com/a.png",
			meta: { mimeType: "image/png", width: 640 },
		});
		expect(
			(
				nextIr.root.children?.[0]?.props.posts as ReadonlyArray<
					Readonly<Record<string, unknown>>
				>
			)[0]?.imageSrc,
		).toBe("https://cdn.example.com/a.png");
		expect(Object.isFrozen(nextIr)).toBe(true);
		expect(Object.isFrozen(nextIr.root)).toBe(true);
		expect(Object.isFrozen(nextIr.assets)).toBe(true);
	});

	it("rewrites broader asset props even when the manifest is incomplete", async () => {
		const registry = createAssetRegistry();
		registry.register({
			id: "asset-1",
			url: "https://cdn.example.com/hero-bg.png",
			meta: { mimeType: "image/png" },
		});
		const resolver = createIRAssetResolver({ registry });
		const ir: PageIR = {
			version: "1",
			root: {
				id: "root",
				type: "__root__",
				props: {},
				children: [
					{
						id: "hero-1",
						type: "Hero",
						props: {
							backgroundSrc: "asset://asset-1",
						},
					},
				],
			},
			assets: [],
			metadata: {},
		};

		const nextIr = await resolveAssets(ir, resolver);

		expect(nextIr.root.children?.[0]?.props.backgroundSrc).toBe(
			"https://cdn.example.com/hero-bg.png",
		);
	});

	it("uses node-scoped assets when collecting URLs to resolve", async () => {
		const registry = createAssetRegistry();
		registry.register({
			id: "asset-1",
			url: "https://cdn.example.com/poster.png",
			meta: { mimeType: "image/png" },
		});
		const resolver = createIRAssetResolver({ registry });
		const ir: PageIR = {
			version: "1",
			root: {
				id: "root",
				type: "__root__",
				props: {},
				children: [
					{
						id: "video-1",
						type: "Video",
						props: {
							poster: "asset://asset-1",
						},
						assets: [{ id: "asset-1", kind: "image", url: "asset://asset-1" }],
					},
				],
			},
			assets: [],
			metadata: {},
		};

		const nextIr = await resolveAssets(ir, resolver);

		expect(nextIr.root.children?.[0]?.props.poster).toBe(
			"https://cdn.example.com/poster.png",
		);
		expect(nextIr.root.children?.[0]?.assets?.[0]).toMatchObject({
			url: "https://cdn.example.com/poster.png",
			meta: { mimeType: "image/png" },
		});
	});
});
