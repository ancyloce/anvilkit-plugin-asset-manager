import {
	createFakeStudioContext,
	registerPlugin,
} from "@anvilkit/core/testing";
import type { StudioPluginContext } from "@anvilkit/core/types";
import type { Data } from "@puckeditor/core";
import { describe, expect, it, vi } from "vitest";

import {
	ASSET_MANAGER_UPLOADED_EVENT,
	createAssetManagerPlugin,
	getAssetRegistry,
	uploadAsset,
} from "../plugin.js";

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
	return { ctx };
}

function countingUploader() {
	let n = 0;
	return vi.fn(async (file: File) => {
		n += 1;
		return {
			id: `asset-${n}`,
			url: `https://cdn.example/${n}.png`,
			name: file.name,
		};
	});
}

const png = (content: string) =>
	new File([content], "a.png", { type: "image/png" });

describe("content dedup (opt-in)", () => {
	it("attaches a SHA-256 hash to the stored asset when dedupe is on", async () => {
		const { ctx } = fakePuckCtx();
		const plugin = createAssetManagerPlugin({
			uploader: countingUploader(),
			folders: false,
			dedupe: true,
		});
		const installed = await registerPlugin(plugin, { ctx });
		await installed.runInit();

		const stored = await uploadAsset(ctx, png("hello world"));
		expect(stored.meta?.hash).toMatch(/^[0-9a-f]{64}$/);
		// Survives the registry freeze reconstruction.
		expect(getAssetRegistry(ctx)?.get(stored.id)?.meta?.hash).toBe(
			stored.meta?.hash,
		);
	});

	it("reuses the existing asset for identical content (no second upload)", async () => {
		const { ctx } = fakePuckCtx();
		const uploader = countingUploader();
		const plugin = createAssetManagerPlugin({
			uploader,
			folders: false,
			dedupe: true,
		});
		const installed = await registerPlugin(plugin, { ctx });
		await installed.runInit();

		const first = await uploadAsset(ctx, png("same bytes"));
		const second = await uploadAsset(ctx, png("same bytes"));

		expect(uploader).toHaveBeenCalledTimes(1);
		expect(second.id).toBe(first.id);
		// Only one asset in the registry.
		expect(getAssetRegistry(ctx)?.list()).toHaveLength(1);
	});

	it("keeps distinct content as separate assets", async () => {
		const { ctx } = fakePuckCtx();
		const uploader = countingUploader();
		const plugin = createAssetManagerPlugin({
			uploader,
			folders: false,
			dedupe: true,
		});
		const installed = await registerPlugin(plugin, { ctx });
		await installed.runInit();

		const a = await uploadAsset(ctx, png("alpha"));
		const b = await uploadAsset(ctx, png("beta"));

		expect(uploader).toHaveBeenCalledTimes(2);
		expect(b.id).not.toBe(a.id);
		expect(getAssetRegistry(ctx)?.list()).toHaveLength(2);
	});

	it("does not hash or dedup when dedupe is off (default)", async () => {
		const { ctx } = fakePuckCtx();
		const uploader = countingUploader();
		const plugin = createAssetManagerPlugin({ uploader, folders: false });
		const installed = await registerPlugin(plugin, { ctx });
		await installed.runInit();

		const first = await uploadAsset(ctx, png("same bytes"));
		const second = await uploadAsset(ctx, png("same bytes"));

		expect(uploader).toHaveBeenCalledTimes(2);
		expect(second.id).not.toBe(first.id);
		expect(first.meta?.hash).toBeUndefined();
	});

	it("emits uploaded + dispatches the existing reference on a dedupe hit", async () => {
		const { ctx } = fakePuckCtx();
		const plugin = createAssetManagerPlugin({
			uploader: countingUploader(),
			folders: false,
			dedupe: true,
		});
		const installed = await registerPlugin(plugin, { ctx });
		await installed.runInit();

		const first = await uploadAsset(ctx, png("dup-bytes"));
		const before = ctx._mocks.emitCalls.length;
		const second = await uploadAsset(ctx, png("dup-bytes"));

		expect(second.id).toBe(first.id);
		const uploaded = ctx._mocks.emitCalls
			.slice(before)
			.filter(([event]) => event === ASSET_MANAGER_UPLOADED_EVENT);
		expect(uploaded).toHaveLength(1);
		expect((uploaded[0]?.[1] as { asset: { id: string } }).asset.id).toBe(
			first.id,
		);
	});

	it("degrades to a normal upload when crypto.subtle is unavailable", async () => {
		const realCrypto = globalThis.crypto;
		vi.stubGlobal("crypto", {
			randomUUID: realCrypto.randomUUID?.bind(realCrypto),
			getRandomValues: realCrypto.getRandomValues?.bind(realCrypto),
			// `subtle` intentionally omitted → computeFileHash returns undefined.
		});
		try {
			const { ctx } = fakePuckCtx();
			const uploader = countingUploader();
			const plugin = createAssetManagerPlugin({
				uploader,
				folders: false,
				dedupe: true,
			});
			const installed = await registerPlugin(plugin, { ctx });
			await installed.runInit();

			const a = await uploadAsset(ctx, png("same"));
			const b = await uploadAsset(ctx, png("same"));

			expect(uploader).toHaveBeenCalledTimes(2); // no hashing ⇒ no dedup
			expect(a.meta?.hash).toBeUndefined();
			expect(b.id).not.toBe(a.id);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("aborts before hashing without calling the uploader", async () => {
		const { ctx } = fakePuckCtx();
		const uploader = countingUploader();
		const plugin = createAssetManagerPlugin({
			uploader,
			folders: false,
			dedupe: true,
		});
		const installed = await registerPlugin(plugin, { ctx });
		await installed.runInit();

		const controller = new AbortController();
		controller.abort();
		await expect(
			uploadAsset(ctx, png("x"), controller.signal),
		).rejects.toBeTruthy();
		expect(uploader).not.toHaveBeenCalled();
	});
});
