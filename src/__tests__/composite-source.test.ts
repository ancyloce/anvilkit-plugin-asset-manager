import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	type CompositeAssetSource,
	createCompositeAssetSource,
} from "../sources/composite-source.js";
import { resolveDataSource, type UploadFn } from "../utils/data-source.js";
import { createAssetRegistry } from "../utils/registry.js";

let registry: ReturnType<typeof createAssetRegistry>;
let composite: CompositeAssetSource;

beforeEach(() => {
	registry = createAssetRegistry();
	const upload: UploadFn = async (file) =>
		registry.register({ id: `up-${file.name}`, url: `blob:${file.name}` });
	const source = resolveDataSource({ registry, upload });
	composite = createCompositeAssetSource({ source, registry, upload });
});

describe("reads route through the data source and project to StudioAsset", () => {
	beforeEach(() => {
		registry.register({
			id: "a1",
			url: "https://x/a1.png",
			meta: { mimeType: "image/png" },
		});
		registry.register({
			id: "a2",
			url: "https://x/a2.png",
			meta: { mimeType: "image/png" },
		});
	});

	it("list() projects every asset with an asset:// url", async () => {
		const items = await composite.list();
		expect(items.map((a) => a.id).sort()).toEqual(["a1", "a2"]);
		expect(items[0]?.url).toMatch(/^asset:\/\//);
		// kind is inferred from the MIME type (URL extension alone ⇒ "other").
		expect(items[0]?.kind).toBe("image");
	});

	it("listPaginated() returns the core page envelope", async () => {
		const page = await composite.listPaginated({ limit: 1 });
		expect(page.items).toHaveLength(1);
		expect(page.total).toBe(2);
		expect(page.nextCursor).toBeDefined();
	});

	it("getUrl returns the asset reference", () => {
		expect(composite.getUrl?.("a1")).toBe("asset://a1");
	});
});

describe("catalog mutations route through the data source", () => {
	beforeEach(() => {
		registry.register({ id: "a1", url: "https://x/a1.png", name: "old" });
	});

	it("delete removes the asset", async () => {
		await composite.delete?.("a1");
		expect(registry.get("a1")).toBeUndefined();
	});

	it("rename updates the asset (void return per StudioAssetSource)", async () => {
		await composite.rename?.("a1", "new");
		expect(registry.get("a1")?.name).toBe("new");
	});

	it("replace runs the file through upload and returns a projected asset", async () => {
		const file = new File(["x"], "shot.png", { type: "image/png" });
		const replaced = await composite.replace?.("a1", file);
		expect(replaced?.id).toBe("a1");
		expect(replaced?.url).toBe("asset://a1");
	});

	it("upload registers and is visible via list", async () => {
		const file = new File(["x"], "new.png", { type: "image/png" });
		const uploaded = await composite.upload([file]);
		expect(uploaded).toHaveLength(1);
		const items = await composite.list();
		expect(items.some((a) => a.id === "up-new.png")).toBe(true);
	});
});

describe("folder surface", () => {
	it("exposes folder ops that route to the data source", async () => {
		registry.register({ id: "a1", url: "https://x/a1.png" });
		const folder = await composite.createFolder(null, "Marketing");
		expect(folder.name).toBe("Marketing");
		await composite.moveAsset("a1", folder.id);
		const renamed = await composite.renameFolder(folder.id, "Mktg");
		expect(renamed.name).toBe("Mktg");
		await composite.removeFolder(folder.id);
	});
});

describe("subscribe", () => {
	it("fires on asset and folder mutations", async () => {
		const listener = vi.fn();
		composite.subscribe?.(listener);
		registry.register({ id: "a1", url: "https://x/a1.png" });
		await composite.createFolder(null, "F");
		expect(listener).toHaveBeenCalledTimes(2);
	});
});

describe("Phase-2 page pass-through + enrichment", () => {
	it("returns folders + breadcrumb and enriches items with folderId/source", async () => {
		registry.register({ id: "a1", url: "https://x/a1.png" });
		const folder = await composite.createFolder(null, "Marketing");
		await composite.moveAsset("a1", folder.id);
		const page = await composite.listPaginated({ folderId: folder.id });
		expect(page.folders).toEqual([]); // no child folders of Marketing
		expect(page.folderPath?.map((f) => f.name)).toEqual(["Marketing"]);
		const item = page.items.find((i) => i.id === "a1");
		expect(item?.folderId).toBe(folder.id);
		expect(item?.source).toBe("local");
	});

	it("listThemes aggregates external providers' themes", async () => {
		const themed = createCompositeAssetSource({
			source: resolveDataSource({
				registry,
				upload: async (f) => ({ id: f.name, url: "u" }),
			}),
			registry,
			upload: async (f) => ({ id: f.name, url: "u" }),
			providers: [
				{
					id: "unsplash",
					label: "Unsplash",
					capabilities: {
						searchable: true,
						themed: true,
						mutable: false,
						requiresAttribution: true,
						folders: false,
					},
					listThemes: () => [
						{ id: "nature", label: "assetManager.unsplash.theme.nature" },
					],
					search: async () => ({ items: [], total: 0, nextCursor: undefined }),
					pickResult: async (a) => ({ id: a.id, url: a.url }),
				},
			],
		});
		const themes = await themed.listThemes?.();
		expect(themes?.map((t) => t.id)).toEqual(["nature"]);
	});

	it("pickResult materializes an external result into the registry", async () => {
		const picked = {
			id: "unsplash:p1",
			url: "https://images.unsplash.com/p1",
			meta: {
				attribution: {
					source: "unsplash" as const,
					photographerName: "Jane",
					photographerUrl: "https://unsplash.com/@jane",
					unsplashUrl: "https://unsplash.com/?utm_source=demo",
					photoUrl: "https://unsplash.com/photos/p1",
					downloadLocation: "https://api.unsplash.com/photos/p1/download",
				},
			},
		};
		const withUnsplash = createCompositeAssetSource({
			source: resolveDataSource({
				registry,
				upload: async (f) => ({ id: f.name, url: "u" }),
			}),
			registry,
			upload: async (f) => ({ id: f.name, url: "u" }),
			providers: [
				{
					id: "unsplash",
					label: "Unsplash",
					capabilities: {
						searchable: true,
						themed: true,
						mutable: false,
						requiresAttribution: true,
						folders: false,
					},
					listThemes: () => [],
					search: async () => ({ items: [], total: 0, nextCursor: undefined }),
					pickResult: async () => picked,
				},
			],
		});

		const result = await withUnsplash.pickResult?.({
			id: "unsplash:p1",
			kind: "image",
			name: "p",
			url: "asset://unsplash:p1",
			source: "unsplash",
		});
		// Registered (so asset://unsplash:p1 resolves) + attribution projected.
		expect(registry.get("unsplash:p1")).toBeDefined();
		expect(result?.source).toBe("unsplash");
		expect(result?.attribution?.photographerName).toBe("Jane");
	});
});
