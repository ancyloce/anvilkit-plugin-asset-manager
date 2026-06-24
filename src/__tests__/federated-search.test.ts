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

	it("emits a URL-safe token (no +, /, or = padding) and round-trips it", () => {
		// Sub-cursors can contain chars that standard base64 maps to +, /, =.
		// The composite cursor is embedded in URLs, so it must use the base64url
		// alphabet with padding stripped (PRD 0002 §9.3). A plain-btoa regression
		// would keep the symmetric round-trip green, so assert the alphabet too.
		const sub = { local: "p/2+offset?", unsplash: "a/b+c==" };
		const token = encodeCompositeCursor(sub);
		expect(token).not.toMatch(/[+/=]/);
		expect(decodeCompositeCursor(token)).toEqual(sub);
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

	it("treats root scope (folderId === null) as a set folder scope", () => {
		// `null` (root) is `!== undefined`, so it must also drop a folders:false
		// provider — otherwise hotlinked remote results leak into the root local
		// folder. This is the exact production query the root view passes.
		const local = fakeProvider("local", [A], { folders: true });
		const remote = fakeProvider("unsplash", [B]);
		expect(providerCanSatisfy(remote, { folderId: null })).toBe(false);
		expect(providerCanSatisfy(local, { folderId: null })).toBe(true);
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

	it("carries a failed provider's cursor forward so the next page retries it (C2)", async () => {
		const local = fakeProvider("local", [A], {
			folders: true,
			nextCursor: "L2",
		});
		let remoteCalls = 0;
		const remote: AssetSourceProvider = {
			...fakeProvider("unsplash", [B]),
			search: vi.fn(async () => {
				remoteCalls += 1;
				if (remoteCalls === 1) {
					return { items: [B], total: 1, nextCursor: "R2" };
				}
				throw new Error("429"); // fails while paginating from "R2"
			}),
		};

		const first = await federatedSearch({
			providers: [local, remote],
			filter: {},
		});
		expect(decodeCompositeCursor(first.nextCursor)).toEqual({
			local: "L2",
			unsplash: "R2",
		});

		// Page 2: remote fails at cursor "R2". Its position must survive so page 3
		// retries it — not silently reset to page 1 (which would skip "R2" and
		// repeat earlier results).
		const second = await federatedSearch({
			providers: [local, remote],
			filter: { cursor: first.nextCursor },
		});
		expect(remote.search).toHaveBeenLastCalledWith(
			expect.anything(),
			"R2",
			undefined,
		);
		expect(decodeCompositeCursor(second.nextCursor)).toEqual({
			local: "L2",
			unsplash: "R2",
		});
		expect(second.items.map((i) => i.id)).toEqual(["a"]); // only the survivor
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

function failingProvider(id: string, error: unknown): AssetSourceProvider {
	return {
		...fakeProvider(id, []),
		search: vi.fn(async () => {
			throw error;
		}),
	};
}

describe("federated provider error propagation", () => {
	it("surfaces per-source errors while still returning successful providers", async () => {
		const good = fakeProvider("local", [A]);
		const bad = failingProvider(
			"unsplash",
			Object.assign(new Error("rate limited"), {
				code: "PROVIDER_RATE_LIMITED",
			}),
		);
		const page = await federatedSearch({ providers: [good, bad], filter: {} });

		expect(page.items.map((i) => i.id)).toContain("a");
		expect(page.sourceErrors?.unsplash).toEqual({
			message: "rate limited",
			code: "PROVIDER_RATE_LIMITED",
		});
		expect(page.sourceErrors?.local).toBeUndefined();
	});

	it("omits sourceErrors when every provider succeeds", async () => {
		const page = await federatedSearch({
			providers: [fakeProvider("local", [A]), fakeProvider("unsplash", [B])],
			filter: {},
		});
		expect(page.sourceErrors).toBeUndefined();
	});

	it("threads sourceErrors through composite.listPaginated", async () => {
		const registry = createAssetRegistry();
		registry.register({ id: "local-1", url: "https://x/l1" });
		const source = resolveDataSource({ registry, upload });
		const composite = createCompositeAssetSource({
			source,
			registry,
			upload,
			providers: [failingProvider("unsplash", new Error("boom"))],
		});
		const page = await composite.listPaginated({});
		expect(page.items.map((i) => i.id)).toEqual(["local-1"]);
		expect(page.sourceErrors?.unsplash?.message).toBe("boom");
	});

	it("captures a structural (non-Error) rejection's message + code", async () => {
		const good = fakeProvider("local", [A]);
		const bad = failingProvider("unsplash", {
			message: "nope",
			code: "PROVIDER_BAD_RESPONSE",
		});
		const page = await federatedSearch({ providers: [good, bad], filter: {} });
		expect(page.items.map((i) => i.id)).toContain("a");
		expect(page.sourceErrors?.unsplash).toEqual({
			message: "nope",
			code: "PROVIDER_BAD_RESPONSE",
		});
	});

	it("never throws when a rejection value's stringification throws", async () => {
		const hostile = {
			toString() {
				throw new Error("boom");
			},
		};
		const good = fakeProvider("local", [A]);
		const bad = failingProvider("unsplash", hostile);
		const page = await federatedSearch({ providers: [good, bad], filter: {} });
		expect(page.items.map((i) => i.id)).toContain("a");
		expect(typeof page.sourceErrors?.unsplash?.message).toBe("string");
	});

	it("skips an exhausted provider (no sub-cursor) on a continuation page", async () => {
		const local = fakeProvider("local", [A]); // no nextCursor ⇒ exhausted
		const unsplash = fakeProvider("unsplash", [B], { nextCursor: "u2" });
		const page1 = await federatedSearch({
			providers: [local, unsplash],
			filter: {},
		});
		expect(page1.nextCursor).toBeDefined();

		await federatedSearch({
			providers: [local, unsplash],
			filter: { cursor: page1.nextCursor },
		});
		// `local` was exhausted on page 1 → NOT re-queried on the continuation page
		// (which would otherwise restart it and duplicate results).
		expect(local.search).toHaveBeenCalledTimes(1);
		expect(unsplash.search).toHaveBeenCalledTimes(2);
	});
});
