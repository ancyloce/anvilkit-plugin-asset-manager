import { compilePlugins } from "@anvilkit/core";
import {
	createFakeStudioContext,
	registerPlugin,
} from "@anvilkit/core/testing";
import type { StudioPluginContext } from "@anvilkit/core/types";
import { puckDataToIR } from "@anvilkit/ir";
import type { Config, Data } from "@puckeditor/core";
import { describe, expect, it } from "vitest";

import { inMemoryUploader } from "../adapters/in-memory.js";
import {
	createAssetManagerPlugin,
	getAssetRegistry,
	uploadAsset,
} from "../plugin.js";

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

	it("persists successful uploads into Puck data that puckDataToIR preserves", async () => {
		let currentData = { root: { props: {} }, content: [], zones: {} } as Data;
		const ctx = createFakeStudioContext({
			getData: () => currentData,
			getPuckApi: (() => ({
				dispatch(action: unknown) {
					if (
						action &&
						typeof action === "object" &&
						"type" in action &&
						action.type === "setData" &&
						"data" in action
					) {
						currentData = action.data as Data;
					}
				},
			})) as StudioPluginContext["getPuckApi"],
		});
		const plugin = createAssetManagerPlugin({
			uploader: async () => ({
				id: "asset-1",
				url: "https://cdn.example.com/image.png",
			}),
		});
		const harness = await registerPlugin(plugin, { ctx });
		await harness.runInit();

		await uploadAsset(
			ctx,
			new File(["hello"], "image.png", { type: "image/png" }),
		);
		const ir = puckDataToIR(currentData, { components: {} } as Config);

		expect(ir.assets).toEqual([
			{
				id: "asset-1",
				kind: "image",
				url: "asset://asset-1",
				meta: {
					mimeType: "image/png",
					size: 5,
				},
			},
		]);
	});
});
