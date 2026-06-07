import { beforeEach, describe, expect, it } from "vitest";

import { AssetSourceError } from "../utils/errors.js";
import { createFolderStore, type FolderStore } from "../utils/folders.js";

let clock = 0;
const now = () => ++clock;

let store: FolderStore;
beforeEach(() => {
	clock = 0;
	store = createFolderStore({ now });
});

describe("createFolder", () => {
	it("creates a root folder and stamps timestamps", () => {
		const f = store.createFolder(null, "Marketing");
		expect(f.parentId).toBeNull();
		expect(f.name).toBe("Marketing");
		expect(f.createdAt).toBeGreaterThan(0);
		expect(f.counts).toEqual({ assets: 0, folders: 0 });
	});

	it("trims the name and rejects empty/whitespace names", () => {
		expect(store.createFolder(null, "  Brand  ").name).toBe("Brand");
		expect(() => store.createFolder(null, "   ")).toThrow(AssetSourceError);
	});

	it("enforces case-insensitive sibling-name uniqueness", () => {
		store.createFolder(null, "Brand");
		expect(() => store.createFolder(null, "brand")).toThrowError(
			/already exists/i,
		);
		// Same name under a different parent is fine.
		const mkt = store.createFolder(null, "Marketing");
		expect(store.createFolder(mkt.id, "Brand").name).toBe("Brand");
	});

	it("rejects creation under an unknown parent", () => {
		expect(() => store.createFolder("nope", "X")).toThrowError(
			/Unknown folder/,
		);
	});

	it("enforces maxDepth", () => {
		const a = store.createFolder(null, "A", 2); // depth 1, ok
		const b = store.createFolder(a.id, "B", 2); // depth 2, ok
		expect(() => store.createFolder(b.id, "C", 2)).toThrowError(
			/maximum folder depth/i,
		);
	});
});

describe("renameFolder", () => {
	it("renames and bumps updatedAt; rejects sibling conflicts", () => {
		const a = store.createFolder(null, "A");
		store.createFolder(null, "B");
		const renamed = store.renameFolder(a.id, "A2");
		expect(renamed.name).toBe("A2");
		expect(renamed.updatedAt).toBeGreaterThan(renamed.createdAt);
		expect(() => store.renameFolder(a.id, "b")).toThrow(AssetSourceError);
	});
});

describe("moveFolder", () => {
	it("reparents a folder", () => {
		const a = store.createFolder(null, "A");
		const b = store.createFolder(null, "B");
		const moved = store.moveFolder(b.id, a.id);
		expect(moved.parentId).toBe(a.id);
		expect(store.listChildren(a.id).map((f) => f.id)).toContain(b.id);
	});

	it("blocks self-parenting and descendant cycles", () => {
		const a = store.createFolder(null, "A");
		const b = store.createFolder(a.id, "B");
		expect(() => store.moveFolder(a.id, a.id)).toThrowError(/into itself/i);
		expect(() => store.moveFolder(a.id, b.id)).toThrowError(/descendant/i);
	});

	it("enforces maxDepth across the moved subtree height", () => {
		const a = store.createFolder(null, "A"); // depth 1
		const b = store.createFolder(a.id, "B"); // depth 2
		store.createFolder(b.id, "C"); // depth 3 (subtree height of B = 1)
		const target = store.createFolder(null, "T"); // depth 1
		// Moving B (height 1) under T would put C at depth 3 → exceeds maxDepth 2.
		expect(() => store.moveFolder(b.id, target.id, 2)).toThrowError(
			/maximum folder depth/i,
		);
	});

	it("is a no-op when the parent is unchanged", () => {
		const a = store.createFolder(null, "A");
		const b = store.createFolder(a.id, "B");
		expect(store.moveFolder(b.id, a.id).id).toBe(b.id);
	});
});

describe("removeFolder", () => {
	it("reparents children to the removed folder's parent by default", () => {
		const a = store.createFolder(null, "A");
		const b = store.createFolder(a.id, "B");
		const c = store.createFolder(b.id, "C");
		store.moveAsset("asset-1", b.id);
		const result = store.removeFolder(b.id);
		expect(result.removedAssetIds).toEqual([]);
		expect(store.get(b.id)).toBeUndefined();
		// C reparented to A; asset-1 reparented to A.
		expect(store.get(c.id)?.parentId).toBe(a.id);
		expect(store.folderOf("asset-1")).toBe(a.id);
	});

	it("reparents to root when the removed folder was top-level", () => {
		const a = store.createFolder(null, "A");
		store.createFolder(a.id, "B");
		store.moveAsset("asset-1", a.id);
		store.removeFolder(a.id);
		expect(store.folderOf("asset-1")).toBeNull();
		expect(store.listChildren(null).some((f) => f.name === "B")).toBe(true);
	});

	it("cascade returns every descendant asset id and drops the subtree", () => {
		const a = store.createFolder(null, "A");
		const b = store.createFolder(a.id, "B");
		store.moveAsset("asset-1", a.id);
		store.moveAsset("asset-2", b.id);
		const result = store.removeFolder(a.id, { cascade: true });
		expect([...result.removedAssetIds].sort()).toEqual(["asset-1", "asset-2"]);
		expect(store.get(a.id)).toBeUndefined();
		expect(store.get(b.id)).toBeUndefined();
		expect(store.folderOf("asset-1")).toBeNull();
	});
});

describe("asset membership", () => {
	it("moves single + batch assets and reflects counts", () => {
		const a = store.createFolder(null, "A");
		store.moveAsset("x", a.id);
		store.moveAssets(["y", "z"], a.id);
		expect(store.folderOf("x")).toBe(a.id);
		expect(store.get(a.id)?.counts.assets).toBe(3);
	});

	it("moving to root drops the side-index entry", () => {
		const a = store.createFolder(null, "A");
		store.moveAsset("x", a.id);
		store.moveAsset("x", null);
		expect(store.folderOf("x")).toBeNull();
		expect(store.get(a.id)?.counts.assets).toBe(0);
	});

	it("batch move validates the target once (all-or-nothing)", () => {
		expect(() => store.moveAssets(["a", "b"], "ghost")).toThrowError(
			/Unknown folder/,
		);
		expect(store.folderOf("a")).toBeNull();
	});

	it("removeAsset drops membership", () => {
		const a = store.createFolder(null, "A");
		store.moveAsset("x", a.id);
		store.removeAsset("x");
		expect(store.folderOf("x")).toBeNull();
	});
});

describe("path / subtree / counts", () => {
	it("builds the breadcrumb root→…→id", () => {
		const a = store.createFolder(null, "A");
		const b = store.createFolder(a.id, "B");
		const c = store.createFolder(b.id, "C");
		expect(store.path(c.id).map((f) => f.name)).toEqual(["A", "B", "C"]);
		expect(store.path(null)).toEqual([]);
	});

	it("computes the descendant subtree set", () => {
		const a = store.createFolder(null, "A");
		const b = store.createFolder(a.id, "B");
		const c = store.createFolder(b.id, "C");
		const ids = store.subtreeIds(a.id);
		expect([...ids].sort()).toEqual([a.id, b.id, c.id].sort());
	});

	it("computes folder counts fresh on read", () => {
		const a = store.createFolder(null, "A");
		store.createFolder(a.id, "B");
		store.moveAsset("x", a.id);
		const got = store.get(a.id);
		expect(got?.counts).toEqual({ assets: 1, folders: 1 });
	});

	it("directAssetIds + counts follow asset moves between folders", () => {
		const a = store.createFolder(null, "A");
		const b = store.createFolder(null, "B");
		store.moveAsset("x", a.id);
		store.moveAsset("y", a.id);
		expect([...store.directAssetIds(a.id)].sort()).toEqual(["x", "y"]);
		expect(store.directAssetIds(b.id)).toEqual([]);
		// Move x A→B: A must release it (no leak in the reverse index), B gains it.
		store.moveAsset("x", b.id);
		expect(store.directAssetIds(a.id)).toEqual(["y"]);
		expect(store.directAssetIds(b.id)).toEqual(["x"]);
		expect(store.get(a.id)?.counts.assets).toBe(1);
		expect(store.get(b.id)?.counts.assets).toBe(1);
	});

	it("childFolderCount follows folder moves between parents", () => {
		const a = store.createFolder(null, "A");
		const b = store.createFolder(null, "B");
		const c = store.createFolder(a.id, "C");
		expect(store.get(a.id)?.counts.folders).toBe(1);
		expect(store.get(b.id)?.counts.folders).toBe(0);
		store.moveFolder(c.id, b.id);
		expect(store.get(a.id)?.counts.folders).toBe(0);
		expect(store.get(b.id)?.counts.folders).toBe(1);
		expect(store.listChildren(b.id).map((f) => f.id)).toEqual([c.id]);
	});
});

describe("subscribe", () => {
	it("fires on mutation and unsubscribes cleanly", () => {
		let hits = 0;
		const off = store.subscribe(() => {
			hits += 1;
		});
		store.createFolder(null, "A");
		expect(hits).toBe(1);
		off();
		store.createFolder(null, "B");
		expect(hits).toBe(1);
	});
});
