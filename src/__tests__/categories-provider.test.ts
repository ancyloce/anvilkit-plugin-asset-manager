import type { StudioAsset } from "@anvilkit/core/types";
import { describe, expect, it } from "vitest";

import type { AssetSourceProvider } from "../sources/provider.js";
import type {
	AssetCategory,
	AssetFacetDefinition,
} from "../types/categories.js";

describe("AssetFacetDefinition / AssetCategory", () => {
	it("supports a local facet with a sync valueOf", () => {
		const facet: AssetFacetDefinition = {
			id: "license",
			label: "assetManager.facet.license",
			selection: "single",
			valueOf: (asset) => asset.tags?.filter((t) => t.startsWith("lic:")),
		};
		expect(
			facet.valueOf?.({ id: "a", url: "blob:x", tags: ["lic:cc0"] }),
		).toEqual(["lic:cc0"]);
	});

	it("supports a remote facet with an async options loader", async () => {
		const facet: AssetFacetDefinition = {
			id: "unsplash:topic",
			label: "assetManager.facet.topic",
			selection: "single",
			remote: true,
			options: async () => [{ value: "nature", label: "Nature" }],
		};
		const opts =
			typeof facet.options === "function"
				? await facet.options({ source: "unsplash" })
				: facet.options;
		expect(opts?.[0]?.value).toBe("nature");
	});

	it("models a saved-view category routed to a provider theme", () => {
		const cat: AssetCategory = {
			id: "nature",
			label: "Nature",
			provider: { source: "unsplash", theme: "nature" },
		};
		expect(cat.provider?.source).toBe("unsplash");
		expect(cat.match).toBeUndefined();
	});
});

describe("AssetSourceProvider", () => {
	it("accepts a conforming read-only provider stub", async () => {
		const provider: AssetSourceProvider = {
			id: "unsplash",
			label: "Unsplash",
			capabilities: {
				searchable: true,
				themed: true,
				mutable: false,
				requiresAttribution: true,
			},
			requiredCsp: () => ({
				connectSrc: ["https://api.unsplash.com"],
				imgSrc: ["https://images.unsplash.com"],
			}),
			listThemes: () => [
				{ id: "nature", label: "assetManager.unsplash.theme.nature" },
			],
			async search() {
				return { items: [], total: 0, nextCursor: undefined };
			},
			async pickResult(asset: StudioAsset) {
				return { id: asset.id, url: asset.url };
			},
		};

		expect(provider.capabilities.mutable).toBe(false);
		const themes = await provider.listThemes();
		expect(themes[0]?.id).toBe("nature");

		const picked = await provider.pickResult({
			id: "unsplash:1",
			kind: "image",
			name: "x",
			url: "https://images.unsplash.com/y",
		});
		expect(picked.id).toBe("unsplash:1");
	});
});
