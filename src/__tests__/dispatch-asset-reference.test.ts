import {
	createFakeStudioContext,
	registerPlugin,
} from "@anvilkit/core/testing";
import type { StudioPluginContext } from "@anvilkit/core/types";
import type { Data } from "@puckeditor/core";
import { describe, expect, it } from "vitest";

import { createAssetManagerPlugin, uploadAsset } from "../plugin.js";

interface AssetEntry {
	readonly id: string;
	readonly kind: string;
	readonly url: string;
	readonly meta?: Readonly<Record<string, unknown>>;
}

function fakePuckCtx() {
	let currentData: Record<string, unknown> = {
		root: { props: {} },
		content: [],
		zones: {},
		assets: [],
	};

	const ctx = createFakeStudioContext({
		getData: () => currentData as unknown as Data,
		getPuckApi: (() => ({
			dispatch(action: unknown) {
				if (
					action &&
					typeof action === "object" &&
					"type" in action &&
					action.type === "setData" &&
					"data" in action
				) {
					currentData = action.data as Record<string, unknown>;
				}
			},
		})) as StudioPluginContext["getPuckApi"],
	});

	return {
		ctx,
		getData: () => currentData,
		setData: (next: Record<string, unknown>) => {
			currentData = next;
		},
	};
}

describe("dispatchAssetReference (targeted IR mutation)", () => {
	it("appends a fresh asset entry when none with the id is present", async () => {
		const harness = fakePuckCtx();
		const plugin = createAssetManagerPlugin({
			uploader: async (file) => ({
				id: "asset-new",
				url: "https://cdn.example.com/n.png",
				name: file.name,
			}),
		});
		const installed = await registerPlugin(plugin, { ctx: harness.ctx });
		await installed.runInit();

		await uploadAsset(
			harness.ctx,
			new File(["x"], "n.png", { type: "image/png" }),
		);

		const assets = harness.getData().assets as AssetEntry[];
		expect(assets).toHaveLength(1);
		expect(assets[0]).toMatchObject({ id: "asset-new", kind: "image" });
	});

	it("replaces an existing asset entry in place (preserves order)", async () => {
		const harness = fakePuckCtx();
		harness.setData({
			...harness.getData(),
			assets: [
				{ id: "asset-a", kind: "other", url: "asset://asset-a" },
				{ id: "asset-target", kind: "image", url: "asset://asset-target" },
				{ id: "asset-b", kind: "other", url: "asset://asset-b" },
			],
		});
		const plugin = createAssetManagerPlugin({
			uploader: async () => ({
				id: "asset-target",
				url: "https://cdn.example.com/v2.png",
			}),
		});
		const installed = await registerPlugin(plugin, { ctx: harness.ctx });
		await installed.runInit();

		await uploadAsset(
			harness.ctx,
			new File(["new bytes"], "v2.png", { type: "image/png" }),
		);

		const assets = harness.getData().assets as AssetEntry[];
		expect(assets.map((a) => a.id)).toEqual([
			"asset-a",
			"asset-target",
			"asset-b",
		]);
		expect(assets[1]).toMatchObject({
			id: "asset-target",
			url: "asset://asset-target",
		});
	});

	it("preserves malformed (non-record) existing entries verbatim", async () => {
		const harness = fakePuckCtx();
		harness.setData({
			...harness.getData(),
			assets: [
				"not-a-record",
				{ id: "asset-keep", kind: "other", url: "asset://asset-keep" },
				42,
			],
		});
		const plugin = createAssetManagerPlugin({
			uploader: async () => ({
				id: "asset-fresh",
				url: "https://cdn.example.com/f.png",
			}),
		});
		const installed = await registerPlugin(plugin, { ctx: harness.ctx });
		await installed.runInit();

		await uploadAsset(
			harness.ctx,
			new File(["x"], "f.png", { type: "image/png" }),
		);

		const assets = harness.getData().assets as unknown[];
		expect(assets).toEqual([
			"not-a-record",
			{ id: "asset-keep", kind: "other", url: "asset://asset-keep" },
			42,
			expect.objectContaining({ id: "asset-fresh", kind: "image" }),
		]);
	});

	it("treats non-array `assets` field as empty (does not throw)", async () => {
		const harness = fakePuckCtx();
		harness.setData({
			...harness.getData(),
			assets: "broken",
		});
		const plugin = createAssetManagerPlugin({
			uploader: async () => ({
				id: "asset-recover",
				url: "https://cdn.example.com/r.png",
			}),
		});
		const installed = await registerPlugin(plugin, { ctx: harness.ctx });
		await installed.runInit();

		await uploadAsset(
			harness.ctx,
			new File(["x"], "r.png", { type: "image/png" }),
		);

		const assets = harness.getData().assets as AssetEntry[];
		expect(assets).toHaveLength(1);
		expect(assets[0]?.id).toBe("asset-recover");
	});
});
