import { createFakeStudioContext } from "@anvilkit/core/testing";
import type { StudioPluginRegistration } from "@anvilkit/core/types";
import { describe, expect, it } from "vitest";

import {
	createAssetManagerPlugin,
	getAssetRegistry,
	uploadAsset,
} from "../plugin.js";

function makeRegisteredCtx(
	uploader: (file: File) => Promise<{
		readonly id: string;
		readonly url: string;
		readonly tags?: readonly string[];
	}>,
) {
	const plugin = createAssetManagerPlugin({ uploader });
	const ctx = createFakeStudioContext();
	const registration = plugin.register(ctx) as StudioPluginRegistration;
	registration.hooks?.onInit?.(ctx);
	return ctx;
}

describe("uploadAsset auto-tag derivation", () => {
	it("derives kind + filename tokens on register", async () => {
		const ctx = makeRegisteredCtx(async (file) => ({
			id: `id-${file.name}`,
			url: `https://cdn.example.com/${file.name}`,
		}));

		const file = new File(["x"], "hero-banner-2024.png", { type: "image/png" });
		const stored = await uploadAsset(ctx, file);

		expect(stored.tags).toBeDefined();
		expect(stored.tags).toContain("image");
		expect(stored.tags).toContain("hero");
		expect(stored.tags).toContain("banner");
		expect(stored.tags?.length).toBeLessThanOrEqual(3);
	});

	it("preserves host-supplied tags verbatim", async () => {
		const ctx = makeRegisteredCtx(async (file) => ({
			id: `id-${file.name}`,
			url: `https://cdn.example.com/${file.name}`,
			tags: ["pre-tagged"],
		}));

		const stored = await uploadAsset(
			ctx,
			new File(["x"], "anything.png", { type: "image/png" }),
		);

		expect(stored.tags).toEqual(["pre-tagged"]);
	});

	it("skips numeric-only and short tokens", async () => {
		const ctx = makeRegisteredCtx(async (file) => ({
			id: `id-${file.name}`,
			url: `https://cdn.example.com/${file.name}`,
		}));

		const file = new File(["x"], "100-2024-a-b.png", { type: "image/png" });
		const stored = await uploadAsset(ctx, file);

		// Only "image" (kind) — numeric-only "100"/"2024" and single-char
		// "a"/"b" tokens are filtered out.
		expect(stored.tags).toEqual(["image"]);

		const registry = getAssetRegistry(ctx);
		expect(registry?.get(stored.id)?.tags).toEqual(["image"]);
	});
});
