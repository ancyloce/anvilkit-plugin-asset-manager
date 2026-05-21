import {
	createFakePageIR,
	createFakeStudioContext,
	registerPlugin,
} from "@anvilkit/core/testing";
import type { StudioPluginContext } from "@anvilkit/core/types";
import { describe, expect, it } from "vitest";
import {
	createAssetManagerPlugin,
	getAssetRegistry,
	uploadAsset,
} from "../plugin.js";
import { AssetValidationError } from "../utils/errors.js";

interface HostileCase {
	readonly label: string;
	readonly url: string;
	readonly code: string;
	/** Optional plugin options to apply for this fixture. */
	readonly opts?: Record<string, unknown>;
}

const HOSTILE_CASES: readonly HostileCase[] = [
	{
		label: "javascript: scheme",
		url: "javascript:alert(1)",
		code: "DISALLOWED_UPLOAD_URL_SCHEME",
	},
	{
		label: "vbscript: scheme",
		url: "vbscript:msgbox(1)",
		code: "DISALLOWED_UPLOAD_URL_SCHEME",
	},
	{
		label: "data: without opt-in",
		url: "data:image/png;base64,AAAA",
		code: "DISALLOWED_UPLOAD_URL_SCHEME",
	},
	{
		label: "literal path traversal in https",
		url: "https://cdn.example.com/../etc/passwd",
		code: "PATH_TRAVERSAL_URL",
	},
	{
		label: "percent-encoded path traversal in https",
		url: "https://cdn.example.com/%2e%2e/etc/passwd",
		code: "PATH_TRAVERSAL_URL",
	},
	{
		label: "mixed-case percent-encoded path traversal",
		url: "https://cdn.example.com/%2E%2E%2Fetc/passwd",
		code: "PATH_TRAVERSAL_URL",
	},
	{
		label: "IDN homoglyph (Cyrillic + Latin)",
		url: "https://аpple.com/img.png",
		code: "MIXED_SCRIPT_HOSTNAME",
	},
];

describe("createAssetManagerPlugin hostile upload handling", () => {
	for (const fixture of HOSTILE_CASES) {
		it(`rejects ${fixture.label} with code ${fixture.code}`, async () => {
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
					url: fixture.url,
				}),
				...(fixture.opts ?? {}),
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
					code: fixture.code,
				}),
			]);
			expect(getAssetRegistry(ctx)?.list()).toEqual([]);
		});
	}

	it("accepts data: URLs once dataUrlAllowlistOptIn is enabled", async () => {
		const ctx = createFakeStudioContext({
			getData: () =>
				asPuckData(
					createFakePageIR({
						rootId: "opt-in-root",
					}),
				),
		});
		const plugin = createAssetManagerPlugin({
			uploader: async () => ({
				id: "asset-data",
				url: "data:image/png;base64,AAAA",
			}),
			dataUrlAllowlistOptIn: true,
		});

		const harness = await registerPlugin(plugin, { ctx });
		await harness.runInit();

		await expect(
			uploadAsset(ctx, new File(["hello"], "hello.png", { type: "image/png" })),
		).resolves.toMatchObject({
			id: "asset-data",
			url: "data:image/png;base64,AAAA",
		});

		expect(getAssetRegistry(ctx)?.list()).toHaveLength(1);
	});

	it("accepts mixed-script hostnames once allowMixedScriptHostnames is enabled", async () => {
		const ctx = createFakeStudioContext({
			getData: () =>
				asPuckData(
					createFakePageIR({
						rootId: "mixed-script-root",
					}),
				),
		});
		const plugin = createAssetManagerPlugin({
			uploader: async () => ({
				id: "asset-mixed",
				url: "https://аpple.com/img.png",
			}),
			allowMixedScriptHostnames: true,
		});

		const harness = await registerPlugin(plugin, { ctx });
		await harness.runInit();

		await expect(
			uploadAsset(ctx, new File(["hello"], "hello.png", { type: "image/png" })),
		).resolves.toMatchObject({
			id: "asset-mixed",
			url: "https://аpple.com/img.png",
		});
	});
});

function asPuckData(
	ir: ReturnType<typeof createFakePageIR>,
): ReturnType<StudioPluginContext["getData"]> {
	return ir as unknown as ReturnType<StudioPluginContext["getData"]>;
}
