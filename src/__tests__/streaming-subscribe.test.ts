import type { StudioAssetUploadEvent } from "@anvilkit/core/types";
import { describe, expect, it } from "vitest";

import { createAssetRegistry } from "../registry.js";
import { createStudioAssetSource } from "../studio-asset-source.js";

describe("createStudioAssetSource.subscribeUploads", () => {
	it("fans upload events out to every subscriber alongside the inline listener", async () => {
		const registry = createAssetRegistry();
		const source = createStudioAssetSource({
			registry,
			upload: async (file) => ({
				id: `id-${file.name}`,
				url: `https://cdn.example.com/${file.name}`,
				name: file.name,
				meta: { mimeType: file.type, size: file.size },
			}),
		});
		const inline: StudioAssetUploadEvent[] = [];
		const subscriberA: StudioAssetUploadEvent[] = [];
		const subscriberB: StudioAssetUploadEvent[] = [];
		source.subscribeUploads?.((event) => {
			subscriberA.push(event);
		});
		source.subscribeUploads?.((event) => {
			subscriberB.push(event);
		});

		const file = new File(["x"], "logo.png", { type: "image/png" });
		await source.upload([file], (event) => {
			inline.push(event);
		});

		expect(inline).toHaveLength(2);
		expect(subscriberA).toEqual(inline);
		expect(subscriberB).toEqual(inline);
	});

	it("the unsubscribe handle stops further deliveries", async () => {
		const registry = createAssetRegistry();
		const source = createStudioAssetSource({
			registry,
			upload: async () => ({
				id: "id-x",
				url: "https://cdn.example.com/x.png",
				name: "x.png",
			}),
		});
		const events: StudioAssetUploadEvent[] = [];
		const unsubscribe = source.subscribeUploads?.((event) => {
			events.push(event);
		});

		await source.upload([new File(["x"], "a.png", { type: "image/png" })]);
		expect(events.length).toBeGreaterThan(0);

		const seenBefore = events.length;
		unsubscribe?.();
		await source.upload([new File(["x"], "b.png", { type: "image/png" })]);
		expect(events.length).toBe(seenBefore);
	});

	it("relays per-file errors to subscribers as error envelopes", async () => {
		const registry = createAssetRegistry();
		const source = createStudioAssetSource({
			registry,
			upload: async () => {
				throw new Error("upload boom");
			},
		});
		const events: StudioAssetUploadEvent[] = [];
		source.subscribeUploads?.((event) => {
			events.push(event);
		});

		await source.upload([new File(["x"], "broken.png", { type: "image/png" })]);

		expect(events).toEqual([{ type: "error", message: "upload boom" }]);
	});
});
