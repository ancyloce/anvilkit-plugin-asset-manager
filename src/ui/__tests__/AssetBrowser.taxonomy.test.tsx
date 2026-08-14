/** @vitest-environment happy-dom */

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
	AssetCategory,
	AssetFacetDefinition,
} from "../../types/categories.js";
import type { UploadResult } from "../../types/types.js";
import { createAssetRegistry } from "../../utils/registry.js";
import { AssetBrowser } from "../AssetBrowser.js";
import { AssetManagerUI } from "../AssetManagerUI.js";
import { cleanup, fireEvent, render, screen } from "./test-utils.js";

afterEach(() => {
	cleanup();
});

const ASSETS: readonly UploadResult[] = [
	{
		id: "hero",
		url: "https://cdn.example/hero.png",
		meta: { mimeType: "image/png" },
		tags: ["brand", "license:cc0"],
	},
	{
		id: "logo",
		url: "https://cdn.example/logo.png",
		meta: { mimeType: "image/png" },
		tags: ["brand", "license:paid"],
	},
	{
		id: "promo",
		url: "https://cdn.example/promo.mp4",
		meta: { mimeType: "video/mp4" },
		tags: ["campaign", "license:cc0"],
	},
];

const CATEGORIES: readonly AssetCategory[] = [
	{ id: "brand", label: "Brand", match: { tags: ["brand"] } },
	{
		id: "nature",
		label: "Nature",
		provider: { source: "unsplash", theme: "nature" },
	},
];

const FACETS: readonly AssetFacetDefinition[] = [
	{
		id: "license",
		label: "License",
		selection: "single",
		appliesTo: ["local"],
		valueOf: (asset) =>
			asset.tags
				?.filter((tag) => tag.startsWith("license:"))
				.map((tag) => tag.slice("license:".length)),
		options: [
			{ value: "cc0", label: "CC0" },
			{ value: "paid", label: "Paid" },
		],
	},
	{
		id: "unsplash:topic",
		label: "Topic",
		selection: "single",
		appliesTo: ["unsplash"],
		remote: true,
		options: async () => [{ value: "business", label: "Business" }],
	},
];

const noop = () => undefined;

describe("AssetBrowser taxonomy configuration", () => {
	it("renders category/facet chips and composes their local matches with AND", async () => {
		const onFilterChange = vi.fn();
		render(
			<AssetBrowser
				assets={ASSETS}
				categories={CATEGORIES}
				facets={FACETS}
				onFilterChange={onFilterChange}
				onInsert={noop}
				searchEnabled
			/>,
		);

		const brand = await screen.findByRole("button", { name: "Brand" });
		fireEvent.click(brand);
		expect(
			screen.getAllByRole("button", { name: /Insert asset/i }),
		).toHaveLength(2);

		fireEvent.click(screen.getByRole("button", { name: "CC0" }));
		const rows = screen.getAllByRole("button", { name: /Insert asset/i });
		expect(rows).toHaveLength(1);
		expect(rows[0]?.getAttribute("aria-label")).toBe("Insert asset hero");
		expect(onFilterChange).toHaveBeenLastCalledWith({
			tags: ["brand"],
			facets: { license: ["cc0"] },
		});

		fireEvent.change(screen.getByLabelText("Search assets"), {
			target: { value: "hero" },
		});
		expect(onFilterChange).toHaveBeenLastCalledWith({
			query: "hero",
			tags: ["brand"],
			facets: { license: ["cc0"] },
		});
	});

	it("routes provider categories and async remote facets without local filtering", async () => {
		const onFilterChange = vi.fn();
		render(
			<AssetBrowser
				assets={ASSETS}
				categories={CATEGORIES}
				facets={FACETS}
				onFilterChange={onFilterChange}
				onInsert={noop}
			/>,
		);

		fireEvent.click(await screen.findByRole("button", { name: "Nature" }));
		expect(
			screen.getAllByRole("button", { name: /Insert asset/i }),
		).toHaveLength(3);
		const business = await screen.findByRole("button", { name: "Business" });
		fireEvent.click(business);

		expect(onFilterChange).toHaveBeenLastCalledWith({
			sources: ["unsplash"],
			facets: {
				"unsplash:topic": ["business"],
				"unsplash:theme": ["nature"],
			},
		});
		expect(
			screen.getAllByRole("button", { name: /Insert asset/i }),
		).toHaveLength(3);
	});

	it("routes an applicable remote facet without requiring a provider category", async () => {
		const onFilterChange = vi.fn();
		const loadOptions = vi.fn(async () => [
			{ value: "business", label: "Business" },
		]);
		const remoteFacet: AssetFacetDefinition = {
			id: "unsplash:topic",
			label: "Topic",
			selection: "single",
			appliesTo: ["unsplash"],
			remote: true,
			options: loadOptions,
		};
		render(
			<AssetBrowser
				assets={ASSETS}
				facets={[remoteFacet]}
				onFilterChange={onFilterChange}
				onInsert={noop}
			/>,
		);

		fireEvent.click(await screen.findByRole("button", { name: "Business" }));
		expect(loadOptions).toHaveBeenCalledWith({ source: "unsplash" });
		expect(onFilterChange).toHaveBeenLastCalledWith({
			sources: ["unsplash"],
			facets: { "unsplash:topic": ["business"] },
		});
		expect(
			screen.getAllByRole("button", { name: /Insert asset/i }),
		).toHaveLength(3);
	});

	it("AssetManagerUI forwards configured taxonomy and composed queries", async () => {
		const registry = createAssetRegistry();
		for (const asset of ASSETS) registry.register(asset);
		const onFilterChange = vi.fn();
		render(
			<AssetManagerUI
				categories={CATEGORIES}
				facets={FACETS}
				onFilterChange={onFilterChange}
				registry={registry}
				uploader={vi.fn()}
			/>,
		);

		fireEvent.click(await screen.findByRole("button", { name: "Brand" }));
		expect(onFilterChange).toHaveBeenLastCalledWith({ tags: ["brand"] });
		expect(
			screen.getAllByRole("button", { name: /Insert asset/i }),
		).toHaveLength(2);
	});

	it("contains rejected async option loaders without rendering stale controls", async () => {
		const rejecting: AssetFacetDefinition = {
			id: "broken",
			label: "Broken",
			selection: "single",
			options: () => Promise.reject(new Error("offline")),
		};
		render(
			<AssetBrowser assets={ASSETS} facets={[rejecting]} onInsert={noop} />,
		);

		await screen.findByRole("list", { name: "Assets" });
		expect(screen.queryByRole("group", { name: "Broken" })).toBeNull();
	});
});
