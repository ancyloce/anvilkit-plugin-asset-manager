import { describe, expect, it } from "vitest";
import type { UploadResult } from "../types/types.js";
import { createAssetRegistry } from "../utils/registry.js";
import { createStudioAssetSource } from "../utils/studio-asset-source.js";

const PNG: UploadResult = {
	id: "png-1",
	url: "https://cdn.example.com/photo.png",
	name: "photo.png",
	meta: { mimeType: "image/png", size: 1024 },
	tags: ["image", "hero"],
};

const MP4: UploadResult = {
	id: "mp4-1",
	url: "https://cdn.example.com/clip.mp4",
	name: "clip.mp4",
	meta: { mimeType: "video/mp4", size: 4096 },
	tags: ["video", "promo"],
};

describe("createStudioAssetSource.listPaginated", () => {
	it("projects search results into StudioAsset shape with tags carried through", async () => {
		const registry = createAssetRegistry();
		registry.register(PNG);
		registry.register(MP4);
		const source = createStudioAssetSource({
			registry,
			upload: async () => PNG,
		});

		const page = await source.listPaginated?.({});
		expect(page?.total).toBe(2);
		expect(page?.items).toHaveLength(2);
		const first = page?.items[0];
		expect(first?.tags).toEqual(["image", "hero"]);
		expect(first?.url).toBe("asset://png-1"); // canonical asset:// URL
	});

	it("filters by kind, tag, and free-text query", async () => {
		const registry = createAssetRegistry();
		registry.register(PNG);
		registry.register(MP4);
		const source = createStudioAssetSource({
			registry,
			upload: async () => PNG,
		});

		const imagesOnly = await source.listPaginated?.({ kinds: ["image"] });
		expect(imagesOnly?.total).toBe(1);
		expect(imagesOnly?.items[0]?.id).toBe("png-1");

		const heroOnly = await source.listPaginated?.({ tags: ["hero"] });
		expect(heroOnly?.total).toBe(1);

		const promoQuery = await source.listPaginated?.({ query: "promo" });
		expect(promoQuery?.total).toBe(1);
		expect(promoQuery?.items[0]?.id).toBe("mp4-1");
	});

	it("paginates via cursor", async () => {
		const registry = createAssetRegistry();
		for (let i = 0; i < 7; i += 1) {
			registry.register({
				id: `asset-${i}`,
				url: `https://cdn.example.com/${i}.png`,
				name: `${i}.png`,
				meta: { mimeType: "image/png", size: 100 },
			});
		}
		const source = createStudioAssetSource({
			registry,
			upload: async () => PNG,
		});

		const first = await source.listPaginated?.({ limit: 3 });
		expect(first?.items).toHaveLength(3);
		expect(first?.nextCursor).toBe("3");

		const second = await source.listPaginated?.({
			limit: 3,
			cursor: first?.nextCursor,
		});
		expect(second?.items).toHaveLength(3);
		expect(second?.nextCursor).toBe("6");

		const third = await source.listPaginated?.({
			limit: 3,
			cursor: second?.nextCursor,
		});
		expect(third?.items).toHaveLength(1);
		expect(third?.nextCursor).toBeUndefined();
	});
});

describe("createStudioAssetSource.setTags", () => {
	it("relays setTags through the registry and notifies subscribers", async () => {
		const registry = createAssetRegistry();
		registry.register(PNG);
		const source = createStudioAssetSource({
			registry,
			upload: async () => PNG,
		});
		let notified = 0;
		source.subscribe?.(() => {
			notified += 1;
		});

		await source.setTags?.("png-1", ["banner", "marketing"]);

		expect(registry.get("png-1")?.tags).toEqual(["banner", "marketing"]);
		expect(notified).toBe(1);
	});
});
