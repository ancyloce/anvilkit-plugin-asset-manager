import { createFakeStudioContext, registerPlugin } from "@anvilkit/core/testing";
import { describe, expect, it } from "vitest";

import { AssetValidationError } from "../errors.js";
import { createAssetManagerPlugin, uploadAsset } from "../plugin.js";

describe("createAssetManagerPlugin maxFileSize", () => {
	it("rejects files that exceed maxFileSize", async () => {
		const ctx = createFakeStudioContext();
		const plugin = createAssetManagerPlugin({
			maxFileSize: 3,
			uploader: async () => ({
				id: "asset-1",
				url: "https://cdn.example.com/asset.txt",
			}),
		});
		const harness = await registerPlugin(plugin, { ctx });
		await harness.runInit();

		const error = await uploadAsset(
			ctx,
			new File(["hello"], "hello.txt", { type: "text/plain" }),
		).catch((caught) => caught);

		expect(error).toBeInstanceOf(AssetValidationError);
		expect((error as AssetValidationError).code).toBe("FILE_TOO_LARGE");
		expect(ctx._mocks.dispatchCalls).toHaveLength(0);
	});
});
