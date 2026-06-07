import { describe, expect, it } from "vitest";
import type { UploadResult } from "../types/types.js";
import { createAssetRegistry } from "../utils/registry.js";

const PNG: UploadResult = {
	id: "img-hero",
	url: "https://cdn.example.com/hero-banner.png",
	name: "hero-banner.png",
	meta: { mimeType: "image/png", size: 1024 },
	tags: ["image", "hero"],
};

const PNG_LOGO: UploadResult = {
	id: "img-logo",
	url: "https://cdn.example.com/logo.png",
	name: "logo.png",
	meta: { mimeType: "image/png", size: 256 },
	tags: ["image", "brand"],
};

const MP4: UploadResult = {
	id: "vid-promo",
	url: "https://cdn.example.com/promo.mp4",
	name: "promo.mp4",
	meta: { mimeType: "video/mp4", size: 4096 },
	tags: ["video", "promo"],
};

const FONT: UploadResult = {
	id: "font-sans",
	url: "https://cdn.example.com/sans.woff2",
	name: "sans.woff2",
	meta: { mimeType: "font/woff2", size: 512 },
	tags: ["font", "brand"],
};

function seed() {
	const registry = createAssetRegistry();
	registry.register(PNG);
	registry.register(PNG_LOGO);
	registry.register(MP4);
	registry.register(FONT);
	return registry;
}

describe("AssetRegistry.search", () => {
	it("returns all assets when no filter is supplied", () => {
		const registry = seed();
		const page = registry.search();
		expect(page.total).toBe(4);
		expect(page.items).toHaveLength(4);
		expect(page.nextCursor).toBeUndefined();
	});

	it("matches the query string against id, name, MIME prefix, and tags", () => {
		const registry = seed();
		expect(registry.search({ query: "hero" }).total).toBe(1);
		expect(registry.search({ query: "logo" }).total).toBe(1);
		expect(registry.search({ query: "image" }).total).toBe(2); // tag + mime
		expect(registry.search({ query: "video/mp4" }).total).toBe(1);
		expect(registry.search({ query: "BRAND" }).total).toBe(2); // case-insensitive
		expect(registry.search({ query: "nope" }).total).toBe(0);
	});

	it("filters by inferred kind", () => {
		const registry = seed();
		expect(registry.search({ kinds: ["image"] }).total).toBe(2);
		expect(registry.search({ kinds: ["video"] }).total).toBe(1);
		expect(registry.search({ kinds: ["font"] }).total).toBe(1);
		expect(registry.search({ kinds: ["image", "video"] }).total).toBe(3);
	});

	it("filters by required tags with AND semantics", () => {
		const registry = seed();
		expect(registry.search({ tags: ["brand"] }).total).toBe(2);
		expect(registry.search({ tags: ["brand", "font"] }).total).toBe(1);
		expect(registry.search({ tags: ["brand", "video"] }).total).toBe(0);
	});

	it("normalizes the query + tag filter (trim, case) once per search", () => {
		const registry = seed();
		// The matcher is compiled once and reused across the scan; the filter is
		// still trimmed + lowercased, so padded/upper-cased input matches the
		// lowercased stored tags + fields (regression guard for the hoist).
		expect(registry.search({ query: "  HERO  " }).total).toBe(1);
		expect(registry.search({ tags: ["  BRAND  "] }).total).toBe(2);
		expect(registry.search({ tags: ["  Brand ", "FONT"] }).total).toBe(1);
		// A filter that normalizes to nothing is a no-op, not a zero-match.
		expect(registry.search({ tags: ["   ", ""] }).total).toBe(4);
	});

	it("composes query + kind + tag filters with AND", () => {
		const registry = seed();
		const page = registry.search({
			query: "image",
			kinds: ["image"],
			tags: ["brand"],
		});
		expect(page.total).toBe(1);
		expect(page.items[0]?.id).toBe("img-logo");
	});

	it("paginates with cursor + limit", () => {
		const registry = createAssetRegistry();
		for (let i = 0; i < 25; i += 1) {
			registry.register({
				id: `asset-${i}`,
				url: `https://cdn.example.com/${i}.png`,
				name: `${i}.png`,
				meta: { mimeType: "image/png", size: 100 },
			});
		}
		const first = registry.search({ limit: 10 });
		expect(first.items).toHaveLength(10);
		expect(first.total).toBe(25);
		expect(first.nextCursor).toBe("10");

		const second = registry.search({ limit: 10, cursor: first.nextCursor });
		expect(second.items).toHaveLength(10);
		expect(second.nextCursor).toBe("20");

		const third = registry.search({ limit: 10, cursor: second.nextCursor });
		expect(third.items).toHaveLength(5);
		expect(third.nextCursor).toBeUndefined();
	});

	it("treats malformed cursors as the first page", () => {
		const registry = seed();
		const page = registry.search({ cursor: "not-a-number", limit: 2 });
		expect(page.items).toHaveLength(2);
	});
});

describe("AssetRegistry.setTags", () => {
	it("sets, normalizes, dedupes, and freezes the tag set", () => {
		const registry = createAssetRegistry();
		registry.register(PNG);

		const next = registry.setTags("img-hero", [
			"  Banner ",
			"BANNER",
			"hero",
			"",
		]);
		expect(next?.tags).toEqual(["banner", "hero"]);
		expect(Object.isFrozen(next?.tags)).toBe(true);
	});

	it("dropping all tags removes the field", () => {
		const registry = createAssetRegistry();
		registry.register(PNG);

		const next = registry.setTags("img-hero", []);
		expect(next?.tags).toBeUndefined();
	});

	it("returns undefined for unknown ids without notifying", () => {
		const registry = createAssetRegistry();
		let notified = 0;
		registry.subscribe(() => {
			notified += 1;
		});

		expect(registry.setTags("missing", ["x"])).toBeUndefined();
		expect(notified).toBe(0);
	});

	it("notifies subscribers on mutation", () => {
		const registry = createAssetRegistry();
		registry.register(PNG);
		let notified = 0;
		registry.subscribe(() => {
			notified += 1;
		});

		registry.setTags("img-hero", ["new"]);
		expect(notified).toBe(1);
	});
});
