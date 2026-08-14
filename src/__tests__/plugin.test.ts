import { compilePlugins } from "@anvilkit/core";
import {
	createFakeStudioContext,
	registerPlugin,
} from "@anvilkit/core/testing";
import type {
	StudioAssetSource,
	StudioPluginContext,
} from "@anvilkit/core/types";
import { puckDataToIR } from "@anvilkit/ir";
import type { Config, Data } from "@puckeditor/core";
import { describe, expect, it, vi } from "vitest";

import { inMemoryUploader } from "../adapters/in-memory.js";
import {
	createAssetManagerPlugin,
	getAssetRegistry,
	uploadAsset,
} from "../plugin.js";
import type { CompositeAssetSource } from "../sources/composite-source.js";
import type {
	AssetCategory,
	AssetFacetDefinition,
} from "../types/categories.js";

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

	it("registers zero-config (no args) — binds a registry + asset resolver through the lifecycle", async () => {
		// Backward-compat (PRD §4.1): `createAssetManagerPlugin()` with no
		// uploader must resolve the in-memory default and register exactly like
		// the explicit `{ uploader }` form.
		const plugin = createAssetManagerPlugin();
		const ctx = createFakeStudioContext();

		const harness = await registerPlugin(plugin, { ctx });
		expect(getAssetRegistry(ctx)).toBeUndefined();

		await harness.runInit();
		expect(getAssetRegistry(ctx)).toBeDefined();
		expect(ctx._mocks.assetResolvers).toHaveLength(1);

		await harness.runDestroy();
		expect(getAssetRegistry(ctx)).toBeUndefined();
	});

	it("threads configured categories and facets into the registered rich source", async () => {
		let source: CompositeAssetSource | StudioAssetSource | undefined;
		const base = createFakeStudioContext();
		const ctx = {
			...base,
			registerAssetSource(next: StudioAssetSource) {
				source = next;
				return () => undefined;
			},
		} as StudioPluginContext;
		const categories: readonly AssetCategory[] = [
			{ id: "brand", label: "Brand", match: { tags: ["brand"] } },
		];
		const facets: readonly AssetFacetDefinition[] = [
			{
				id: "license",
				label: "License",
				selection: "single",
				valueOf: (asset) => asset.tags,
				options: [{ value: "cc0", label: "CC0" }],
			},
		];
		const plugin = createAssetManagerPlugin({
			folders: false,
			categories,
			facets,
		});
		const harness = await registerPlugin(plugin, { ctx });
		await harness.runInit();
		await vi.waitFor(() => {
			expect((source as CompositeAssetSource | undefined)?.categories).toBe(
				categories,
			);
		});
		expect((source as CompositeAssetSource).facets).toBe(facets);

		const registry = getAssetRegistry(ctx);
		registry?.register({ id: "cc0", url: "blob:cc0", tags: ["cc0"] });
		registry?.register({ id: "paid", url: "blob:paid", tags: ["paid"] });
		const page = await source?.listPaginated?.({
			facets: { license: ["cc0"] },
		});
		expect(page?.items.map((asset) => asset.id)).toEqual(["cc0"]);
	});

	it("replaces through ingest without registering or dispatching the adapter's fresh id", async () => {
		let source: StudioAssetSource | undefined;
		const base = createFakeStudioContext();
		const ctx = {
			...base,
			registerAssetSource(next: StudioAssetSource) {
				source = next;
				return () => undefined;
			},
		} as StudioPluginContext;
		const plugin = createAssetManagerPlugin({
			folders: false,
			uploader: async (file) => ({
				id: "fresh-adapter-id",
				url: `https://cdn.example.com/${file.name}`,
			}),
		});
		const harness = await registerPlugin(plugin, { ctx });
		await harness.runInit();
		const registry = getAssetRegistry(ctx);
		registry?.register({
			id: "asset-old",
			url: "https://cdn.example.com/old.png",
		});
		let mutationCount = 0;
		registry?.subscribe(() => {
			mutationCount += 1;
		});

		const replaced = await source?.replace?.(
			"asset-old",
			new File(["new"], "new.png", { type: "image/png" }),
		);

		expect(replaced?.id).toBe("asset-old");
		expect(registry?.list().map((asset) => asset.id)).toEqual(["asset-old"]);
		expect(registry?.get("fresh-adapter-id")).toBeUndefined();
		expect(mutationCount).toBe(1);
		expect(base._mocks.dispatchCalls).toHaveLength(0);
		expect(base._mocks.emitCalls).toHaveLength(0);
	});

	it("isolates runtime state when one plugin object is mounted in two Studios", async () => {
		let uploadCount = 0;
		const plugin = createAssetManagerPlugin({
			folders: false,
			uploader: async () => {
				uploadCount += 1;
				return {
					id: `asset-${uploadCount}`,
					url: `https://cdn.example.com/asset-${uploadCount}.png`,
				};
			},
		});
		const ctxA = createFakeStudioContext();
		const ctxB = createFakeStudioContext();
		const harnessA = await registerPlugin(plugin, { ctx: ctxA });
		const harnessB = await registerPlugin(plugin, { ctx: ctxB });

		await Promise.all([harnessA.runInit(), harnessB.runInit()]);

		const registryA = getAssetRegistry(ctxA);
		const registryB = getAssetRegistry(ctxB);
		expect(registryA).toBeDefined();
		expect(registryB).toBeDefined();
		expect(registryA).not.toBe(registryB);

		await uploadAsset(
			ctxA,
			new File(["first"], "first.png", { type: "image/png" }),
		);
		expect(registryA?.list().map((asset) => asset.id)).toEqual(["asset-1"]);
		expect(registryB?.list()).toEqual([]);

		await harnessA.runDestroy();
		expect(getAssetRegistry(ctxA)).toBeUndefined();
		expect(getAssetRegistry(ctxB)).toBe(registryB);

		await uploadAsset(
			ctxB,
			new File(["second"], "second.png", { type: "image/png" }),
		);
		expect(registryB?.list().map((asset) => asset.id)).toEqual(["asset-2"]);

		await harnessB.runDestroy();
		expect(getAssetRegistry(ctxB)).toBeUndefined();
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
