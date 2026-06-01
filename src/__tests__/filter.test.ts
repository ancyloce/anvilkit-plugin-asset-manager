import { describe, expect, it } from "vitest";

import type { AssetFilter, AssetListPage } from "../types/filter.js";
import type { AssetSearchOptions, AssetSearchPage } from "../types/types.js";

describe("AssetFilter / AssetListPage contracts", () => {
	it("accepts a bare AssetSearchOptions as an AssetFilter (additive superset)", () => {
		const base: AssetSearchOptions = {
			query: "hero",
			kinds: ["image"],
			limit: 10,
		};
		// Compiles only if AssetFilter is a superset of AssetSearchOptions.
		const filter: AssetFilter = base;
		expect(filter.query).toBe("hero");
		expect(filter.kinds).toEqual(["image"]);
	});

	it("carries the unified folder view on the page envelope", () => {
		const page: AssetListPage = {
			items: [],
			total: 0,
			nextCursor: undefined,
			folders: [],
			folderPath: [],
		};
		// Compiles only if AssetListPage extends AssetSearchPage.
		const asSearchPage: AssetSearchPage = page;
		expect(asSearchPage.total).toBe(0);
		expect(page.folders).toEqual([]);
		expect(page.folderPath).toEqual([]);
	});

	it("composes folder / source / facet / sort axes with the legacy fields", () => {
		const filter: AssetFilter = {
			query: "logo",
			kinds: ["image"],
			tags: ["brand"],
			folderId: "fld_1",
			recursive: true,
			sources: ["local", "unsplash"],
			facets: { license: ["cc0"] },
			sort: { field: "name", direction: "asc" },
		};
		expect(filter.folderId).toBe("fld_1");
		expect(filter.recursive).toBe(true);
		expect(filter.sources).toContain("unsplash");
		expect(filter.sort?.field).toBe("name");
	});
});
