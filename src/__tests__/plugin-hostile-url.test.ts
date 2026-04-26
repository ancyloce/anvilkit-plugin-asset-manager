import {
	createFakePageIR,
	createFakeStudioContext,
	registerPlugin,
} from "@anvilkit/core/testing";
import type { StudioPluginContext } from "@anvilkit/core/types";
import { describe, expect, it } from "vitest";

import { AssetValidationError } from "../errors.js";
import {
	createAssetManagerPlugin,
	getAssetRegistry,
	uploadAsset,
} from "../plugin.js";

describe("createAssetManagerPlugin hostile upload handling", () => {
	it("emits asset-manager:error and does not touch IR or registry", async () => {
		const ctx = createFakeStudioContext({
			getData: () =>
				asPuckData(
					createFakePageIR({
						rootId: "hostile-root",
					}),
				),
		});
		const plugin = createAssetManagerPlugin({
			uploader: async () => ({
				id: "asset-hostile",
				url: "javascript:alert(1)",
			}),
		});

		const harness = await registerPlugin(plugin, { ctx });
		await harness.runInit();

		await expect(
			uploadAsset(
				ctx,
				new File(["hello"], "hello.txt", { type: "text/plain" }),
			),
		).rejects.toBeInstanceOf(AssetValidationError);

		expect(ctx._mocks.dispatchCalls).toHaveLength(0);
		expect(ctx._mocks.emitCalls).toContainEqual([
			"asset-manager:error",
			expect.objectContaining({
				code: "DISALLOWED_UPLOAD_URL_SCHEME",
			}),
		]);
		expect(getAssetRegistry(ctx)?.list()).toEqual([]);
	});
});

function asPuckData(
	ir: ReturnType<typeof createFakePageIR>,
): ReturnType<StudioPluginContext["getData"]> {
	return ir as unknown as ReturnType<StudioPluginContext["getData"]>;
}
