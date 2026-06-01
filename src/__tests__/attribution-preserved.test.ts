import { describe, expect, it } from "vitest";

import type { AssetMeta } from "../types/types.js";
import { createAssetRegistry } from "../utils/registry.js";

const attribution: NonNullable<AssetMeta["attribution"]> = {
	source: "unsplash",
	photographerName: "Jane Doe",
	photographerUrl: "https://unsplash.com/@jane?utm_source=demo",
	unsplashUrl: "https://unsplash.com/?utm_source=demo",
	photoUrl: "https://images.unsplash.com/photo-1",
	downloadLocation: "https://api.unsplash.com/photos/1/download",
};

describe("registry preserves meta.attribution through the freeze reconstructor", () => {
	it("survives register → get", () => {
		const registry = createAssetRegistry();
		registry.register({
			id: "u1",
			url: "https://images.unsplash.com/photo-1",
			meta: { mimeType: "image/jpeg", attribution },
		});
		expect(registry.get("u1")?.meta?.attribution).toEqual(attribution);
	});

	it("survives rename and setTags (every mutation runs through freeze)", () => {
		const registry = createAssetRegistry();
		registry.register({
			id: "u1",
			url: "https://images.unsplash.com/photo-1",
			meta: { attribution },
		});
		const renamed = registry.rename("u1", "Mountain");
		expect(renamed?.meta?.attribution).toEqual(attribution);
		const tagged = registry.setTags("u1", ["nature"]);
		expect(tagged?.meta?.attribution).toEqual(attribution);
	});

	it("freezes the attribution object", () => {
		const registry = createAssetRegistry();
		const stored = registry.register({
			id: "u1",
			url: "https://images.unsplash.com/photo-1",
			meta: { attribution },
		});
		expect(Object.isFrozen(stored.meta?.attribution)).toBe(true);
	});
});
