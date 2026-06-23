import {
	createFakeStudioContext,
	registerPlugin,
} from "@anvilkit/core/testing";
import { describe, expect, it } from "vitest";
import { createAssetManagerPlugin, uploadAsset } from "../plugin.js";
import { AssetValidationError } from "../utils/errors.js";

describe("createAssetManagerPlugin acceptedMimeTypes", () => {
	it("rejects MIME types outside the configured allowlist", async () => {
		const ctx = createFakeStudioContext();
		const plugin = createAssetManagerPlugin({
			acceptedMimeTypes: ["image/png"],
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
		expect((error as AssetValidationError).code).toBe("UNSUPPORTED_MIME_TYPE");
		expect(ctx._mocks.dispatchCalls).toHaveLength(0);
	});

	it("rejects file extensions outside the configured allowlist", async () => {
		const ctx = createFakeStudioContext();
		const plugin = createAssetManagerPlugin({
			acceptedFileExtensions: [".png"],
			uploader: async () => ({
				id: "asset-1",
				url: "https://cdn.example.com/asset.txt",
			}),
		});
		const harness = await registerPlugin(plugin, { ctx });
		await harness.runInit();

		const error = await uploadAsset(
			ctx,
			new File(["hello"], "hello.txt", { type: "image/png" }),
		).catch((caught) => caught);

		expect(error).toBeInstanceOf(AssetValidationError);
		expect((error as AssetValidationError).code).toBe(
			"UNSUPPORTED_FILE_EXTENSION",
		);
		expect(ctx._mocks.dispatchCalls).toHaveLength(0);
	});

	it("accepts files with an empty browser MIME type when the extension matches", async () => {
		const ctx = createFakeStudioContext();
		const plugin = createAssetManagerPlugin({
			acceptedFileExtensions: ["png"],
			acceptedMimeTypes: ["image/png"],
			uploader: async () => ({
				id: "asset-1",
				url: "https://cdn.example.com/asset.png",
			}),
		});
		const harness = await registerPlugin(plugin, { ctx });
		await harness.runInit();

		const uploaded = await uploadAsset(ctx, new File(["hello"], "hero.PNG"));

		expect(uploaded.id).toBe("asset-1");
		expect(ctx._mocks.dispatchCalls).toHaveLength(1);
	});

	it("requires both MIME and extension allowlists when both are configured", async () => {
		const ctx = createFakeStudioContext();
		const plugin = createAssetManagerPlugin({
			acceptedFileExtensions: ["png"],
			acceptedMimeTypes: ["image/png"],
			uploader: async () => ({
				id: "asset-1",
				url: "https://cdn.example.com/asset.png",
			}),
		});
		const harness = await registerPlugin(plugin, { ctx });
		await harness.runInit();

		const error = await uploadAsset(
			ctx,
			new File(["hello"], "hero.txt", { type: "image/png" }),
		).catch((caught) => caught);

		expect(error).toBeInstanceOf(AssetValidationError);
		expect((error as AssetValidationError).code).toBe(
			"UNSUPPORTED_FILE_EXTENSION",
		);
		expect(ctx._mocks.dispatchCalls).toHaveLength(0);
	});
});
