import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	createInMemoryDataSource,
	type ResolvedAssetDataSource,
	type UploadFn,
} from "../utils/data-source.js";
import { AssetSourceError } from "../utils/errors.js";
import { createFolderStore } from "../utils/folders.js";
import { createAssetRegistry } from "../utils/registry.js";

const upload: UploadFn = async (file) => ({
	id: `up-${file.name}`,
	url: `blob:${file.name}`,
});

function setup() {
	const registry = createAssetRegistry();
	const folders = createFolderStore({ now: () => 1 });
	const ds = createInMemoryDataSource({
		registry,
		upload,
		folderStore: folders,
	});
	return { registry, folders, ds };
}

let registry: ReturnType<typeof createAssetRegistry>;
let folders: ReturnType<typeof createFolderStore>;
let ds: ResolvedAssetDataSource;
beforeEach(() => {
	({ registry, folders, ds } = setup());
});

describe("list — folder scoping", () => {
	beforeEach(() => {
		registry.register({ id: "a1", url: "https://x/a1.png" });
		registry.register({ id: "a2", url: "https://x/a2.png" });
		registry.register({ id: "a3", url: "https://x/a3.png" });
	});

	it("undefined folderId returns all assets and omits the folder view", async () => {
		const page = await ds.list({});
		expect(page.items.map((a) => a.id).sort()).toEqual(["a1", "a2", "a3"]);
		expect(page.folders).toBeUndefined();
		expect(page.folderPath).toBeUndefined();
	});

	it("scopes items to a folder and returns children + breadcrumb", async () => {
		const f = folders.createFolder(null, "Marketing");
		folders.moveAsset("a1", f.id);
		const page = await ds.list({ folderId: f.id });
		expect(page.items.map((a) => a.id)).toEqual(["a1"]);
		expect(page.folderPath?.map((p) => p.name)).toEqual(["Marketing"]);
		expect(page.folders).toEqual([]);
	});

	it("root scope (null) returns only un-foldered assets", async () => {
		const f = folders.createFolder(null, "M");
		folders.moveAsset("a1", f.id);
		const page = await ds.list({ folderId: null });
		expect(page.items.map((a) => a.id).sort()).toEqual(["a2", "a3"]);
	});

	it("recursive includes assets in descendant folders", async () => {
		const f = folders.createFolder(null, "F");
		const g = folders.createFolder(f.id, "G");
		folders.moveAsset("a1", f.id);
		folders.moveAsset("a2", g.id);
		const shallow = await ds.list({ folderId: f.id });
		expect(shallow.items.map((a) => a.id)).toEqual(["a1"]);
		const deep = await ds.list({ folderId: f.id, recursive: true });
		expect(deep.items.map((a) => a.id).sort()).toEqual(["a1", "a2"]);
	});

	it("composes query/kind/tag filters with the folder clause", async () => {
		const f = folders.createFolder(null, "F");
		folders.moveAsset("a1", f.id);
		folders.moveAsset("a2", f.id);
		registry.setTags("a1", ["hero"]);
		const page = await ds.list({ folderId: f.id, tags: ["hero"] });
		expect(page.items.map((a) => a.id)).toEqual(["a1"]);
	});
});

describe("asset mutations", () => {
	beforeEach(() => {
		registry.register({ id: "a1", url: "https://x/a1.png", name: "old" });
	});

	it("remove deletes from the registry and drops folder membership", async () => {
		const f = folders.createFolder(null, "F");
		folders.moveAsset("a1", f.id);
		await ds.remove("a1");
		expect(registry.get("a1")).toBeUndefined();
		expect(folders.folderOf("a1")).toBeNull();
	});

	it("rename returns the updated asset; rejects ASSET_MUTATION_REJECTED for unknown id", async () => {
		const renamed = await ds.rename("a1", "new");
		expect(renamed.name).toBe("new");
		await expect(ds.rename("ghost", "x")).rejects.toMatchObject({
			code: "ASSET_MUTATION_REJECTED",
		});
		await expect(ds.rename("ghost", "x")).rejects.toBeInstanceOf(
			AssetSourceError,
		);
	});

	it("replace runs the file through upload and preserves the id", async () => {
		const file = new File(["data"], "shot.png", { type: "image/png" });
		const result = await ds.replace("a1", file);
		expect(result.id).toBe("a1"); // registry.replace preserves the original id
		expect(result.url).toBe("blob:shot.png");
	});

	it("replace re-checks the abort signal AFTER upload and never mutates the registry", async () => {
		// Disposal safety (PRD 0002 §6): a replace cancelled while the upload is
		// in flight must throw AbortError before touching the registry.
		const reg = createAssetRegistry();
		reg.register({ id: "a1", url: "https://x/a1.png" });
		const replaceSpy = vi.spyOn(reg, "replace");
		const controller = new AbortController();
		const abortingUpload: UploadFn = async (file) => {
			controller.abort(); // cancel after the await resolves, before the write
			return { id: `up-${file.name}`, url: `blob:${file.name}` };
		};
		const aborted = createInMemoryDataSource({
			registry: reg,
			upload: abortingUpload,
			folderStore: createFolderStore({ now: () => 1 }),
		});
		await expect(
			aborted.replace(
				"a1",
				new File(["d"], "s.png", { type: "image/png" }),
				controller.signal,
			),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(replaceSpy).not.toHaveBeenCalled();
	});

	it("folder membership survives a registry freeze round-trip (rename + setTags)", async () => {
		// Membership is an asset→folder SIDE-INDEX, never a field on
		// UploadResult, so the freeze-allowlist rebuild on rename/setTags
		// (registry.ts) cannot strip it (PRD 0002 §7, folders.ts header).
		const f = folders.createFolder(null, "F");
		folders.moveAsset("a1", f.id);
		registry.rename("a1", "renamed");
		registry.setTags("a1", ["hero"]);
		expect(folders.folderOf("a1")).toBe(f.id);
		const page = await ds.list({ folderId: f.id });
		expect(page.items.map((i) => i.id)).toContain("a1");
	});

	it("move places an asset into a folder", async () => {
		const f = folders.createFolder(null, "F");
		await ds.move("a1", f.id);
		expect(folders.folderOf("a1")).toBe(f.id);
	});

	it("rejects asset moves when allowMove is false", async () => {
		const f = folders.createFolder(null, "F");
		const locked = createInMemoryDataSource({
			registry,
			upload,
			folderStore: folders,
			allowMove: false,
		});
		await expect(locked.move("a1", f.id)).rejects.toMatchObject({
			code: "MOVE_REJECTED",
		});
		expect(folders.folderOf("a1")).toBeNull();
	});
});

describe("folder mutations via the data source", () => {
	it("create/rename/move/remove delegate to the store", async () => {
		const f = await ds.createFolder(null, "F");
		expect(f.name).toBe("F");
		const renamed = await ds.renameFolder(f.id, "F2");
		expect(renamed.name).toBe("F2");
		const g = await ds.createFolder(null, "G");
		const moved = await ds.moveFolder(g.id, f.id);
		expect(moved.parentId).toBe(f.id);
		await ds.removeFolder(f.id);
		expect(folders.get(f.id)).toBeUndefined();
	});

	it("removeFolder cascade deletes the descendant assets from the registry", async () => {
		registry.register({ id: "a1", url: "https://x/a1.png" });
		const f = await ds.createFolder(null, "F");
		folders.moveAsset("a1", f.id);
		await ds.removeFolder(f.id, { cascade: true });
		expect(registry.get("a1")).toBeUndefined();
	});

	it("rejects folder moves when allowMove is false", async () => {
		const locked = createInMemoryDataSource({
			registry,
			upload,
			folderStore: folders,
			allowMove: false,
		});
		const f = await locked.createFolder(null, "F");
		const g = await locked.createFolder(null, "G");
		await expect(locked.moveFolder(g.id, f.id)).rejects.toMatchObject({
			code: "MOVE_REJECTED",
		});
		expect(folders.get(g.id)?.parentId).toBeNull();
	});
});

describe("subscriptions", () => {
	it("subscribe fires on both asset and folder mutations", () => {
		const listener = vi.fn();
		const off = ds.subscribe(listener);
		registry.register({ id: "a1", url: "https://x/a1.png" });
		folders.createFolder(null, "F");
		expect(listener).toHaveBeenCalledTimes(2);
		off();
		registry.register({ id: "a2", url: "https://x/a2.png" });
		expect(listener).toHaveBeenCalledTimes(2);
	});

	it("subscribeStatus emits idle for the synchronous source", () => {
		const listener = vi.fn();
		ds.subscribeStatus(listener);
		expect(listener).toHaveBeenCalledWith({ phase: "idle" });
	});
});
