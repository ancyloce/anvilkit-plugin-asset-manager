import {
	createFakeStudioContext,
	registerPlugin,
} from "@anvilkit/core/testing";
import type { StudioPluginContext } from "@anvilkit/core/types";
import type { Data } from "@puckeditor/core";
import { describe, expect, it, vi } from "vitest";
import {
	ASSET_MANAGER_ERROR_EVENT,
	createAssetManagerPlugin,
	uploadAsset,
} from "../plugin.js";
import type { AssetManagerOptions } from "../types/options.js";

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff, 0xe0];

function bytesFile(bytes: number[], name: string, type: string): File {
	return new File([new Uint8Array(bytes)], name, { type });
}

function fakeCtx() {
	let data: Record<string, unknown> = {
		root: { props: {} },
		content: [],
		zones: {},
		assets: [],
	};
	return createFakeStudioContext({
		getData: () => data as unknown as Data,
		getPuckApi: (() => ({
			dispatch(action: unknown) {
				if (
					action &&
					typeof action === "object" &&
					"type" in action &&
					action.type === "setData" &&
					"data" in action
				) {
					data = action.data as Record<string, unknown>;
				}
			},
		})) as StudioPluginContext["getPuckApi"],
	});
}

async function setup(opts: Partial<AssetManagerOptions>) {
	const ctx = fakeCtx();
	const uploader = vi.fn(async (file: File) => ({
		id: "a1",
		url: "https://cdn.example/a1",
		name: file.name,
	}));
	const plugin = createAssetManagerPlugin({
		uploader,
		folders: false,
		...opts,
	});
	const installed = await registerPlugin(plugin, { ctx });
	await installed.runInit();
	return { ctx, uploader };
}

describe("opt-in content sniffing", () => {
	it("rejects a file whose content contradicts its declared type", async () => {
		const { ctx, uploader } = await setup({ sniffContent: true });
		await expect(
			uploadAsset(ctx, bytesFile(JPEG, "fake.png", "image/png")),
		).rejects.toMatchObject({
			name: "AssetValidationError",
			code: "CONTENT_TYPE_MISMATCH",
		});
		expect(uploader).not.toHaveBeenCalled();
	});

	it("allows content that matches its declared type", async () => {
		const { ctx, uploader } = await setup({ sniffContent: true });
		await uploadAsset(ctx, bytesFile(PNG, "real.png", "image/png"));
		expect(uploader).toHaveBeenCalledOnce();
	});

	it("treats image/jpg as image/jpeg (alias)", async () => {
		const { ctx, uploader } = await setup({ sniffContent: true });
		await uploadAsset(ctx, bytesFile(JPEG, "a.jpg", "image/jpg"));
		expect(uploader).toHaveBeenCalledOnce();
	});

	it("passes empty and generic declared types", async () => {
		const { ctx, uploader } = await setup({ sniffContent: true });
		await uploadAsset(ctx, bytesFile(JPEG, "a", ""));
		await uploadAsset(ctx, bytesFile(JPEG, "a", "application/octet-stream"));
		expect(uploader).toHaveBeenCalledTimes(2);
	});

	it("passes unsignable content (no known magic bytes)", async () => {
		const { ctx, uploader } = await setup({ sniffContent: true });
		await uploadAsset(
			ctx,
			new File(["just plain text"], "a.txt", { type: "text/plain" }),
		);
		expect(uploader).toHaveBeenCalledOnce();
	});

	it("does not sniff when sniffContent is off (default)", async () => {
		const { ctx, uploader } = await setup({});
		// Spoofed type, but sniffing is disabled → allowed through.
		await uploadAsset(ctx, bytesFile(JPEG, "fake.png", "image/png"));
		expect(uploader).toHaveBeenCalledOnce();
	});

	it("emits asset-manager:error with CONTENT_TYPE_MISMATCH on a mismatch", async () => {
		const { ctx } = await setup({ sniffContent: true });
		await expect(
			uploadAsset(ctx, bytesFile(JPEG, "fake.png", "image/png")),
		).rejects.toBeTruthy();
		const errors = ctx._mocks.emitCalls.filter(
			([event]) => event === ASSET_MANAGER_ERROR_EVENT,
		);
		expect(errors).toHaveLength(1);
		expect((errors[0]![1] as { code: string }).code).toBe(
			"CONTENT_TYPE_MISMATCH",
		);
	});

	it("does not invoke the uploader for a pre-aborted upload", async () => {
		const { ctx, uploader } = await setup({ sniffContent: true });
		const controller = new AbortController();
		controller.abort();
		// Empty type makes the sniff short-circuit; the unified pre-upload guard
		// must still bail before the adapter runs.
		await expect(
			uploadAsset(ctx, bytesFile(JPEG, "x", ""), controller.signal),
		).rejects.toBeTruthy();
		expect(uploader).not.toHaveBeenCalled();
	});
});
