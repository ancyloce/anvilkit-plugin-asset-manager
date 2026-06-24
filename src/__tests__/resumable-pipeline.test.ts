import {
	createFakeStudioContext,
	registerPlugin,
} from "@anvilkit/core/testing";
import type { StudioPluginContext } from "@anvilkit/core/types";
import type { Data } from "@puckeditor/core";
import { describe, expect, it, vi } from "vitest";

import { createAssetManagerPlugin, uploadAsset } from "../plugin.js";
import type { ResumableUploadAdapter } from "../types/resumable.js";

interface AssetEntry {
	readonly id: string;
	readonly url: string;
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
	return { ctx, getData: () => currentData };
}

function makeFile(name: string, bytes: number): File {
	return new File(["x".repeat(bytes)], name, { type: "image/png" });
}

function fakeResumableAdapter(
	overrides: { completeUrl?: string; partSize?: number } = {},
): {
	adapter: ResumableUploadAdapter;
	calls: { begin: number; parts: number; complete: number };
} {
	const calls = { begin: 0, parts: 0, complete: 0 };
	const partSize = overrides.partSize ?? 10;
	const adapter: ResumableUploadAdapter = {
		begin: () => {
			calls.begin += 1;
			return Promise.resolve({ uploadId: "mpu", parts: [], partSize });
		},
		uploadPart: (_session, part) => {
			calls.parts += 1;
			return Promise.resolve({
				partNumber: part.partNumber,
				etag: `e${part.partNumber}`,
			});
		},
		complete: () => {
			calls.complete += 1;
			return Promise.resolve({
				id: "resumable-asset",
				url: overrides.completeUrl ?? "https://cdn.example.com/big.png",
			});
		},
		abort: () => Promise.resolve(),
	};
	return { adapter, calls };
}

describe("resumable upload pipeline integration", () => {
	it("uses the single-shot uploader for files below the threshold", async () => {
		const singleShot = vi.fn(async (file: File) => ({
			id: "small",
			url: "https://cdn.example.com/s.png",
			name: file.name,
		}));
		const { adapter, calls } = fakeResumableAdapter();
		const harness = fakePuckCtx();
		const plugin = createAssetManagerPlugin({
			uploader: singleShot,
			resumable: { adapter, threshold: 1000, partSize: 10 },
		});
		const installed = await registerPlugin(plugin, { ctx: harness.ctx });
		await installed.runInit();

		await uploadAsset(harness.ctx, makeFile("s.png", 10));

		expect(singleShot).toHaveBeenCalledOnce();
		expect(calls.begin).toBe(0);
	});

	it("routes files at/above the threshold through the resumable runner", async () => {
		const singleShot = vi.fn();
		const { adapter, calls } = fakeResumableAdapter();
		const harness = fakePuckCtx();
		const plugin = createAssetManagerPlugin({
			uploader: singleShot,
			resumable: { adapter, threshold: 20, partSize: 10 },
		});
		const installed = await registerPlugin(plugin, { ctx: harness.ctx });
		await installed.runInit();

		const stored = await uploadAsset(harness.ctx, makeFile("big.png", 30));

		expect(singleShot).not.toHaveBeenCalled();
		expect(calls.begin).toBe(1);
		expect(calls.parts).toBe(3); // 30 bytes / 10-byte parts
		expect(calls.complete).toBe(1);
		expect(stored.id).toBe("resumable-asset");
		// Registered + dispatched into Puck data as an asset:// reference.
		const assets = harness.getData().assets as AssetEntry[];
		expect(assets.some((a) => a.id === "resumable-asset")).toBe(true);
	});

	it("defaults the threshold to partSize when threshold is omitted", async () => {
		const singleShot = vi.fn(async (file: File) => ({
			id: "small",
			url: "https://cdn.example.com/s.png",
			name: file.name,
		}));
		const { adapter, calls } = fakeResumableAdapter();
		const harness = fakePuckCtx();
		const plugin = createAssetManagerPlugin({
			uploader: singleShot,
			resumable: { adapter, partSize: 10 }, // threshold defaults to 10
		});
		const installed = await registerPlugin(plugin, { ctx: harness.ctx });
		await installed.runInit();

		await uploadAsset(harness.ctx, makeFile("tiny.png", 8)); // < 10 → single-shot
		expect(singleShot).toHaveBeenCalledOnce();
		expect(calls.begin).toBe(0);

		await uploadAsset(harness.ctx, makeFile("big.png", 25)); // ≥ 10 → resumable
		expect(calls.begin).toBe(1);
	});

	it("still validates the resumable result through the trust boundary", async () => {
		const { adapter } = fakeResumableAdapter({
			completeUrl: "javascript:alert(1)",
		});
		const harness = fakePuckCtx();
		const plugin = createAssetManagerPlugin({
			uploader: vi.fn(),
			resumable: { adapter, threshold: 20, partSize: 10 },
		});
		const installed = await registerPlugin(plugin, { ctx: harness.ctx });
		await installed.runInit();

		await expect(
			uploadAsset(harness.ctx, makeFile("big.png", 30)),
		).rejects.toMatchObject({ name: "AssetValidationError" });
		// The hostile asset must NOT have been registered/dispatched.
		const assets = harness.getData().assets as AssetEntry[];
		expect(assets).toHaveLength(0);
	});

	it("treats a file exactly at the threshold as resumable (>=)", async () => {
		const singleShot = vi.fn();
		const { adapter, calls } = fakeResumableAdapter();
		const harness = fakePuckCtx();
		const plugin = createAssetManagerPlugin({
			uploader: singleShot,
			resumable: { adapter, threshold: 20, partSize: 10 },
		});
		const installed = await registerPlugin(plugin, { ctx: harness.ctx });
		await installed.runInit();

		await uploadAsset(harness.ctx, makeFile("edge.png", 20)); // size === threshold
		expect(singleShot).not.toHaveBeenCalled();
		expect(calls.begin).toBe(1);
	});

	it("defaults the threshold to 8 MiB when neither threshold nor partSize is set", async () => {
		const eightMiB = 8 * 1024 * 1024;
		// Adapter reports an 8 MiB part size so the boundary file is a single part.
		const { adapter, calls } = fakeResumableAdapter({ partSize: eightMiB });
		const singleShot = vi.fn(async (file: File) => ({
			id: "small",
			url: "https://cdn.example.com/s.png",
			name: file.name,
		}));
		const harness = fakePuckCtx();
		const plugin = createAssetManagerPlugin({
			uploader: singleShot,
			resumable: { adapter }, // no threshold, no partSize → default 8 MiB
		});
		const installed = await registerPlugin(plugin, { ctx: harness.ctx });
		await installed.runInit();

		await uploadAsset(harness.ctx, makeFile("tiny.png", 1024)); // < 8 MiB
		expect(singleShot).toHaveBeenCalledOnce();
		expect(calls.begin).toBe(0);

		await uploadAsset(harness.ctx, makeFile("huge.png", eightMiB)); // == 8 MiB
		expect(calls.begin).toBe(1);
	});

	it("forwards an aborted signal into the resumable runner", async () => {
		const { adapter, calls } = fakeResumableAdapter();
		const harness = fakePuckCtx();
		const plugin = createAssetManagerPlugin({
			uploader: vi.fn(),
			resumable: { adapter, threshold: 20, partSize: 10 },
		});
		const installed = await registerPlugin(plugin, { ctx: harness.ctx });
		await installed.runInit();

		const controller = new AbortController();
		controller.abort();
		await expect(
			uploadAsset(harness.ctx, makeFile("big.png", 30), controller.signal),
		).rejects.toBeTruthy();
		// Runner saw the aborted signal and bailed before opening a session.
		expect(calls.begin).toBe(0);
	});

	it("forwards a custom sessionStore (cleared on success)", async () => {
		const sessionStore = {
			load: vi.fn(() => undefined),
			save: vi.fn(),
			clear: vi.fn(),
		};
		const { adapter } = fakeResumableAdapter();
		const harness = fakePuckCtx();
		const plugin = createAssetManagerPlugin({
			uploader: vi.fn(),
			resumable: { adapter, threshold: 20, partSize: 10, sessionStore },
		});
		const installed = await registerPlugin(plugin, { ctx: harness.ctx });
		await installed.runInit();

		await uploadAsset(harness.ctx, makeFile("big.png", 30));
		expect(sessionStore.save).toHaveBeenCalled();
		expect(sessionStore.clear).toHaveBeenCalled();
	});
});
