import { describe, expect, it, vi } from "vitest";

import { createAssetManagerPlugin } from "../index.js";
import type { AssetDataSource } from "../types/data-source.js";
import { resolveDataSource, type UploadFn } from "../utils/data-source.js";
import { createAssetRegistry } from "../utils/registry.js";

const upload: UploadFn = async (file) => ({
	id: `up-${file.name}`,
	url: `blob:${file.name}`,
});

const emptyPage = { items: [], total: 0, nextCursor: undefined };

function fullAssetHost(): AssetDataSource {
	return {
		list: vi.fn(async () => emptyPage),
		remove: vi.fn(async () => undefined),
		replace: vi.fn(async () => ({ id: "x", url: "blob:x" })),
		rename: vi.fn(async () => ({ id: "x", url: "blob:x" })),
		move: vi.fn(async () => undefined),
	};
}

describe("resolveDataSource — per-plane ladder", () => {
	it("uses the in-memory default when no host data source is supplied", async () => {
		const registry = createAssetRegistry();
		registry.register({ id: "a1", url: "https://x/a1.png" });
		const resolved = resolveDataSource({ registry, upload });
		const page = await resolved.list({});
		expect(page.items.map((a) => a.id)).toEqual(["a1"]);
	});

	it("routes the whole asset plane to a host that implements all of it", async () => {
		const registry = createAssetRegistry();
		const host = fullAssetHost();
		const resolved = resolveDataSource({
			registry,
			upload,
			hostDataSource: host,
		});
		await resolved.list({});
		await resolved.remove("a1");
		expect(host.list).toHaveBeenCalledTimes(1);
		expect(host.remove).toHaveBeenCalledTimes(1);
	});

	it("warns and falls back for a PARTIAL asset plane (no split store)", async () => {
		const registry = createAssetRegistry();
		registry.register({ id: "a1", url: "https://x/a1.png" });
		const warn = vi.fn();
		const host: AssetDataSource = { list: vi.fn(async () => emptyPage) };
		const resolved = resolveDataSource({
			registry,
			upload,
			hostDataSource: host,
			warn,
		});
		const page = await resolved.list({});
		expect(warn).toHaveBeenCalledOnce();
		expect(warn.mock.calls[0]?.[0]).toMatch(/partial asset method set/i);
		// host.list ignored; the in-memory default served the registry.
		expect(host.list).not.toHaveBeenCalled();
		expect(page.items.map((a) => a.id)).toEqual(["a1"]);
	});

	it("resolves the folder plane independently of the asset plane", async () => {
		const registry = createAssetRegistry();
		const host: AssetDataSource = {
			createFolder: vi.fn(async () => ({
				id: "f",
				name: "F",
				parentId: null,
				createdAt: 0,
				updatedAt: 0,
				counts: { assets: 0, folders: 0 },
			})),
			renameFolder: vi.fn(),
			removeFolder: vi.fn(),
			moveFolder: vi.fn(),
		};
		const resolved = resolveDataSource({
			registry,
			upload,
			hostDataSource: host,
		});
		await resolved.createFolder(null, "F");
		expect(host.createFolder).toHaveBeenCalledOnce();
	});

	it("warns and falls back for a PARTIAL folder plane (whole plane → in-memory)", async () => {
		// Symmetric to the partial-asset-plane case: a host that implements only
		// SOME folder methods gets the WHOLE folder plane served by the in-memory
		// default, with one warning (PRD 0002 §5 per-plane ladder).
		const registry = createAssetRegistry();
		const warn = vi.fn();
		const host: AssetDataSource = {
			createFolder: vi.fn(async () => ({
				id: "f",
				name: "F",
				parentId: null,
				createdAt: 0,
				updatedAt: 0,
				counts: { assets: 0, folders: 0 },
			})),
		};
		const resolved = resolveDataSource({
			registry,
			upload,
			hostDataSource: host,
			warn,
		});
		const folder = await resolved.createFolder(null, "F");
		expect(warn).toHaveBeenCalledOnce();
		expect(warn.mock.calls[0]?.[0]).toMatch(/partial folder method set/i);
		// host.createFolder ignored; the in-memory store created the folder.
		expect(host.createFolder).not.toHaveBeenCalled();
		expect(folder.name).toBe("F");
	});

	it("prefers a host subscribeStatus when provided", () => {
		const registry = createAssetRegistry();
		const subscribeStatus = vi.fn(() => () => undefined);
		const resolved = resolveDataSource({
			registry,
			upload,
			hostDataSource: { subscribeStatus },
		});
		resolved.subscribeStatus(() => undefined);
		expect(subscribeStatus).toHaveBeenCalledOnce();
	});

	it("blocks host-provided move methods when allowMove is false", async () => {
		const registry = createAssetRegistry();
		const host: AssetDataSource = {
			...fullAssetHost(),
			createFolder: vi.fn(),
			renameFolder: vi.fn(),
			removeFolder: vi.fn(),
			moveFolder: vi.fn(),
		};
		const resolved = resolveDataSource({
			registry,
			upload,
			hostDataSource: host,
			allowMove: false,
		});

		await expect(resolved.move("a1", "folder-1")).rejects.toMatchObject({
			code: "MOVE_REJECTED",
		});
		await expect(resolved.moveFolder("folder-1", null)).rejects.toMatchObject({
			code: "MOVE_REJECTED",
		});
		expect(host.move).not.toHaveBeenCalled();
		expect(host.moveFolder).not.toHaveBeenCalled();
	});
});

describe("createAssetManagerPlugin zero-config", () => {
	it("is callable with no arguments (uploader + options default)", () => {
		const plugin = createAssetManagerPlugin();
		expect(plugin.meta).toBeDefined();
		expect(typeof plugin.register).toBe("function");
	});
});
