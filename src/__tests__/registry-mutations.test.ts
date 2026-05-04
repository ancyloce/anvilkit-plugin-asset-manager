import { describe, expect, it } from "vitest";

import { createAssetRegistry } from "../registry.js";

const SEED = {
	id: "asset-1",
	url: "https://cdn.example.com/photo.png",
	name: "photo.png",
	meta: { mimeType: "image/png", size: 100 },
} as const;

describe("AssetRegistry mutations", () => {
	it("delete returns true when an entry was removed", () => {
		const registry = createAssetRegistry();
		registry.register(SEED);

		expect(registry.delete("asset-1")).toBe(true);
		expect(registry.get("asset-1")).toBeUndefined();
		expect(registry.delete("asset-1")).toBe(false);
	});

	it("rename updates the entry's name and notifies subscribers", () => {
		const registry = createAssetRegistry();
		registry.register(SEED);
		let notified = 0;
		registry.subscribe(() => {
			notified += 1;
		});

		const next = registry.rename("asset-1", "hero.png");

		expect(next?.name).toBe("hero.png");
		expect(registry.get("asset-1")?.name).toBe("hero.png");
		expect(notified).toBe(1);
	});

	it("rename returns undefined for unknown ids without notifying", () => {
		const registry = createAssetRegistry();
		let notified = 0;
		registry.subscribe(() => {
			notified += 1;
		});

		expect(registry.rename("missing", "x")).toBeUndefined();
		expect(notified).toBe(0);
	});

	it("replace preserves the original id even when next carries a different one", () => {
		const registry = createAssetRegistry();
		registry.register(SEED);

		const next = registry.replace("asset-1", {
			id: "ignored",
			url: "https://cdn.example.com/v2.png",
			name: "v2.png",
			meta: { mimeType: "image/png", size: 200 },
		});

		expect(next?.id).toBe("asset-1");
		expect(next?.url).toBe("https://cdn.example.com/v2.png");
		expect(registry.get("asset-1")?.name).toBe("v2.png");
	});

	it("replace returns undefined when the id is unknown", () => {
		const registry = createAssetRegistry();

		expect(
			registry.replace("missing", {
				id: "missing",
				url: "https://cdn.example.com/x.png",
			}),
		).toBeUndefined();
	});

	it("subscribe returns an unsubscribe handle", () => {
		const registry = createAssetRegistry();
		let notified = 0;
		const unsubscribe = registry.subscribe(() => {
			notified += 1;
		});

		registry.register(SEED);
		expect(notified).toBe(1);

		unsubscribe();
		registry.register({ ...SEED, id: "asset-2" });
		expect(notified).toBe(1);
	});
});
