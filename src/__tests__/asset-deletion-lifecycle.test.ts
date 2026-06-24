import {
	createFakeStudioContext,
	registerPlugin,
} from "@anvilkit/core/testing";
import type {
	StudioAssetSource,
	StudioPluginContext,
} from "@anvilkit/core/types";
import type { Data } from "@puckeditor/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { inMemoryUploader } from "../adapters/in-memory.js";
import { createAssetManagerPlugin } from "../plugin.js";
import { createInMemoryDataSource } from "../utils/data-source.js";
import { createAssetRegistry } from "../utils/registry.js";
import { createStudioAssetSource } from "../utils/studio-asset-source.js";

const noopUpload = async () => ({ id: "x", url: "https://cdn.example/x" });

describe("createStudioAssetSource onDelete", () => {
	it("fires with the removed record after a successful delete", async () => {
		const registry = createAssetRegistry();
		registry.register({ id: "a1", url: "https://cdn.example/a1.png" });
		const onDelete = vi.fn();
		const source = createStudioAssetSource({
			registry,
			upload: noopUpload,
			onDelete,
		});

		await source.delete?.("a1");
		expect(onDelete).toHaveBeenCalledTimes(1);
		expect(onDelete).toHaveBeenCalledWith(
			expect.objectContaining({ id: "a1" }),
		);
	});

	it("does not fire when deleting an unknown asset (still rejects)", async () => {
		const registry = createAssetRegistry();
		const onDelete = vi.fn();
		const source = createStudioAssetSource({
			registry,
			upload: noopUpload,
			onDelete,
		});

		await expect(source.delete?.("missing")).rejects.toBeTruthy();
		expect(onDelete).not.toHaveBeenCalled();
	});
});

describe("createInMemoryDataSource onDelete", () => {
	it("fires with the removed record after remove()", async () => {
		const registry = createAssetRegistry();
		registry.register({ id: "a1", url: "https://cdn.example/a1.png" });
		const onDelete = vi.fn();
		const source = createInMemoryDataSource({
			registry,
			upload: noopUpload,
			onDelete,
		});

		await source.remove("a1");
		expect(onDelete).toHaveBeenCalledWith(
			expect.objectContaining({ id: "a1" }),
		);
	});

	it("rejects removing an unknown asset (delete contract parity)", async () => {
		const registry = createAssetRegistry();
		const source = createInMemoryDataSource({ registry, upload: noopUpload });
		await expect(source.remove("missing")).rejects.toMatchObject({
			code: "ASSET_MUTATION_REJECTED",
		});
	});

	it("fires onDelete for every asset removed by a folder cascade", async () => {
		const registry = createAssetRegistry();
		const onDelete = vi.fn();
		const source = createInMemoryDataSource({
			registry,
			upload: noopUpload,
			onDelete,
		});
		const folder = await source.createFolder(null, "clips");
		registry.register({ id: "a1", url: "blob:asset-manager/a1" });
		registry.register({ id: "a2", url: "https://cdn.example/a2.png" });
		await source.move("a1", folder.id);
		await source.move("a2", folder.id);

		await source.removeFolder(folder.id, { cascade: true });
		expect(onDelete).toHaveBeenCalledTimes(2);
		expect(onDelete.mock.calls.map((c) => c[0].id).sort()).toEqual([
			"a1",
			"a2",
		]);
	});
});

describe("plugin asset-deletion lifecycle", () => {
	const original = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");

	afterEach(() => {
		if (original) {
			Object.defineProperty(URL, "revokeObjectURL", original);
		} else {
			delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
		}
	});

	it("revokes blob: URLs and invokes onAssetDeleted on delete", async () => {
		const revoke = vi.fn();
		Object.defineProperty(URL, "revokeObjectURL", {
			value: revoke,
			configurable: true,
			writable: true,
		});

		const onAssetDeleted = vi.fn();
		let source: StudioAssetSource | undefined;
		const base = createFakeStudioContext({
			getData: () =>
				({ root: { props: {} }, content: [], zones: {} }) as unknown as Data,
		});
		const ctx = {
			...base,
			registerAssetSource: (s: StudioAssetSource) => {
				source = s;
				return () => undefined;
			},
		} as unknown as StudioPluginContext;

		// folders:false ⇒ the lightweight registry source registers synchronously.
		const plugin = createAssetManagerPlugin({
			uploader: inMemoryUploader(),
			folders: false,
			onAssetDeleted,
		});
		const installed = await registerPlugin(plugin, { ctx });
		await installed.runInit();
		expect(source).toBeDefined();

		const uploaded = await source?.upload([
			new File(["data"], "a.png", { type: "image/png" }),
		]);
		const id = uploaded?.[0]?.id;
		expect(id).toBeDefined();

		await source?.delete?.(id as string);
		expect(revoke).toHaveBeenCalledWith(expect.stringMatching(/^blob:/));
		expect(onAssetDeleted).toHaveBeenCalledTimes(1);
	});
});
