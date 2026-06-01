import { describe, expect, it, vi } from "vitest";

import { createCompositeAssetSource } from "../sources/composite-source.js";
import {
	createLocalProvider,
	decodeCompositeCursor,
	encodeCompositeCursor,
	federatedSearch,
	providerCanSatisfy,
} from "../sources/federated-search.js";
import type { AssetSourceProvider } from "../sources/provider.js";
import type { UploadResult } from "../types/types.js";
import { resolveDataSource, type UploadFn } from "../utils/data-source.js";
import { createAssetRegistry } from "../utils/registry.js";

const upload: UploadFn = async (file) => ({
	id: `up-${file.name}`,
	url: `blob:${file.name}`,
});

function fakeProvider(
	id: string,
	items: readonly UploadResult[],
	opts: { folders?: boolean; nextCursor?: string } = {},
): AssetSourceProvider {
	return {
		id,
		label: id,
		capabilities: {
			searchable: true,
			themed: false,
			mutable: false,
			requiresAttribution: false,
			folders: opts.folders ?? false,
		},
		listThemes: () => [],
		search: vi.fn(async () => ({
			items,
			total: items.length,
			nextCursor: opts.nextCursor,
		})),
		pickResult: async (a) => ({ id: a.id, url: a.url }),
	};
}

const A: UploadResult = { id: "a", url: "https://x/a", name: "Apple" };
const B: UploadResult = { id: "b", url: "https://x/b", name: "Banana" };

describe("composite cursor", () => {
	it("round-trips per-source sub-cursors through an opaque token", () => {
		const token = encodeCompositeCursor({ local: "5", unsplash: "2" });
		expect(typeof token).toBe("string");
		expect(decodeCompositeCursor(token)).toEqual({ local: "5", unsplash: "2" });
	});

	it("decodes an undefined/garbage token to an empty cursor", () => {
		expect(decodeCompositeCursor(undefined)).toEqual({});
		expect(decodeCompositeCursor("!!not-base64!!")).toEqual({});
	});
});

describe("providerCanSatisfy", () => {
	it("drops a non-folder provider for a folder-scoped query", () => {
		const local = fakeProvider("local", [A], { folders: true });
		const remote = fakeProvider("unsplash", [B]);
		expect(providerCanSatisfy(local, { folderId: "f" })).toBe(true);
		expect(providerCanSatisfy(remote, { folderId: "f" })).toBe(false);
		expect(providerCanSatisfy(remote, {})).toBe(true);
	});
});

describe("federatedSearch — route vs federate", () => {
	it("routes to exactly the named source (no other provider call)", async () => {
		const local = fakeProvider("local", [A], { folders: true });
		const remote = fakeProvider("unsplash", [B]);
		const page = await federatedSearch({
			providers: [local, remote],
			filter: { sources: ["unsplash"] },
		});
		expect(page.items.map((i) => i.id)).toEqual(["b"]);
		expect(remote.search).toHaveBeenCalledOnce();
		expect(local.search).not.toHaveBeenCalled();
	});

	it("federates across all eligible providers (local first)", async () => {
		const local = fakeProvider("local", [A], { folders: true });
		const remote = fakeProvider("unsplash", [B]);
		const page = await federatedSearch({
			providers: [local, remote],
			filter: {},
		});
		expect(page.items.map((i) => i.id)).toEqual(["a", "b"]);
		expect(page.total).toBe(2);
	});

	it("excludes folder-incapable providers from a folder-scoped federation", async () => {
		const local = fakeProvider("local", [A], { folders: true });
		const remote = fakeProvider("unsplash", [B]);
		const page = await federatedSearch({
			providers: [local, remote],
			filter: { folderId: "f" },
		});
		expect(page.items.map((i) => i.id)).toEqual(["a"]);
		expect(remote.search).not.toHaveBeenCalled();
	});

	it("is resilient: a failing provider does not blank the others", async () => {
		const local = fakeProvider("local", [A], { folders: true });
		const broken: AssetSourceProvider = {
			...fakeProvider("unsplash", []),
			search: vi.fn(async () => {
				throw new Error("429");
			}),
		};
		const page = await federatedSearch({
			providers: [local, broken],
			filter: {},
		});
		expect(page.items.map((i) => i.id)).toEqual(["a"]);
	});
});

describe("federatedSearch — cursors & sort", () => {
	it("composes a next cursor and hands each provider its own sub-cursor", async () => {
		const local = fakeProvider("local", [A], {
			folders: true,
			nextCursor: "5",
		});
		const remote = fakeProvider("unsplash", [B], { nextCursor: "2" });
		const first = await federatedSearch({
			providers: [local, remote],
			filter: {},
		});
		expect(decodeCompositeCursor(first.nextCursor)).toEqual({
			local: "5",
			unsplash: "2",
		});
		expect(first.sourceCursors).toEqual({ local: "5", unsplash: "2" });

		await federatedSearch({
			providers: [local, remote],
			filter: { cursor: first.nextCursor },
		});
		expect(local.search).toHaveBeenLastCalledWith(
			expect.anything(),
			"5",
			undefined,
		);
		expect(remote.search).toHaveBeenLastCalledWith(
			expect.anything(),
			"2",
			undefined,
		);
	});

	it("k-way merges comparable sorts (name) across providers", async () => {
		const local = fakeProvider("local", [B], { folders: true }); // Banana
		const remote = fakeProvider("unsplash", [A]); // Apple
		const page = await federatedSearch({
			providers: [local, remote],
			filter: { sort: { field: "name", direction: "asc" } },
		});
		expect(page.items.map((i) => i.name)).toEqual(["Apple", "Banana"]);
	});
});

describe("createLocalProvider", () => {
	it("delegates search to the resolved data source and is folder-capable", async () => {
		const registry = createAssetRegistry();
		registry.register({ id: "x", url: "https://x/x" });
		const source = resolveDataSource({ registry, upload });
		const local = createLocalProvider(source, registry);
		expect(local.capabilities.folders).toBe(true);
		const page = await local.search({}, undefined);
		expect(page.items.map((i) => i.id)).toEqual(["x"]);
	});
});

describe("composite source federates extra providers", () => {
	it("merges local + an extra provider through listPaginated", async () => {
		const registry = createAssetRegistry();
		registry.register({ id: "local-1", url: "https://x/l1" });
		const source = resolveDataSource({ registry, upload });
		const composite = createCompositeAssetSource({
			source,
			registry,
			upload,
			providers: [fakeProvider("unsplash", [B])],
		});
		const page = await composite.listPaginated({});
		expect(page.items.map((i) => i.id).sort()).toEqual(["b", "local-1"]);
	});
});
