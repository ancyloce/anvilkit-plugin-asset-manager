import { compilePlugins } from "@anvilkit/core";
import { createFakeStudioContext, registerPlugin } from "@anvilkit/core/testing";
import { describe, expect, it } from "vitest";

import { inMemoryUploader } from "../adapters/in-memory.js";
import { getAssetRegistry } from "../plugin.js";
import { createAssetManagerPlugin } from "../plugin.js";

describe("createAssetManagerPlugin", () => {
	it("compiles through compilePlugins and binds a registry for the plugin lifecycle", async () => {
		const plugin = createAssetManagerPlugin({
			uploader: inMemoryUploader(),
		});
		const ctx = createFakeStudioContext();

		const runtime = await compilePlugins([plugin], ctx);
		expect(runtime.headerActions.map((action) => action.id)).toEqual([
			"asset-manager:upload",
		]);

		const harness = await registerPlugin(plugin, { ctx });
		expect(getAssetRegistry(ctx)).toBeUndefined();
		expect(ctx._mocks.assetResolvers).toEqual([]);

		await harness.runInit();
		expect(getAssetRegistry(ctx)).toBeDefined();
		expect(ctx._mocks.assetResolvers).toHaveLength(1);

		await harness.runDestroy();
		expect(getAssetRegistry(ctx)).toBeUndefined();
	});
});
