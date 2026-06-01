import { describe, expect, it } from "vitest";

import { type AssetFolder, resolveFolderId } from "../types/folders.js";

describe("resolveFolderId", () => {
	it("collapses undefined to null (root)", () => {
		expect(resolveFolderId(undefined)).toBeNull();
		expect(resolveFolderId()).toBeNull();
	});

	it("collapses null to null (root)", () => {
		expect(resolveFolderId(null)).toBeNull();
	});

	it("is identity on a real folder id", () => {
		expect(resolveFolderId("fld_1")).toBe("fld_1");
	});
});

describe("AssetFolder root semantics", () => {
	it("models a root folder with parentId null", () => {
		const root: AssetFolder = {
			id: "root",
			name: "All assets",
			parentId: null,
			createdAt: 0,
			updatedAt: 0,
			counts: { assets: 0, folders: 0 },
		};
		expect(root.parentId).toBeNull();
		expect(resolveFolderId(root.parentId)).toBeNull();
	});

	it("models a nested folder pointing at its parent", () => {
		const child: AssetFolder = {
			id: "child",
			name: "Q3",
			parentId: "marketing",
			createdAt: 1,
			updatedAt: 2,
			counts: { assets: 3, folders: 1 },
			meta: { color: "blue" },
		};
		expect(resolveFolderId(child.parentId)).toBe("marketing");
		expect(child.counts.assets).toBe(3);
	});
});
