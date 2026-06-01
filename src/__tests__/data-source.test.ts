import { describe, expect, it } from "vitest";

import type {
	AssetDataSource,
	AssetSourceStatus,
} from "../types/data-source.js";
import { AssetSourceError } from "../utils/errors.js";

describe("AssetDataSource shape", () => {
	it("allows an empty data source — every method is optional", () => {
		const ds: AssetDataSource = {};
		expect(ds.list).toBeUndefined();
		expect(ds.createFolder).toBeUndefined();
	});

	it("accepts a fully-implemented async data source and unifies the read", async () => {
		const ds: AssetDataSource = {
			async list() {
				return {
					items: [],
					total: 0,
					nextCursor: undefined,
					folders: [],
					folderPath: [],
				};
			},
			async remove() {
				await Promise.resolve();
			},
			async rename(_id, name) {
				return { id: "1", url: "blob:x", name };
			},
			async move() {
				await Promise.resolve();
			},
			async createFolder(parentId, name) {
				return {
					id: "f",
					name,
					parentId,
					createdAt: 0,
					updatedAt: 0,
					counts: { assets: 0, folders: 0 },
				};
			},
			subscribeStatus() {
				return () => undefined;
			},
		};

		const page = await ds.list?.({ folderId: null });
		expect(page?.total).toBe(0);
		expect(page?.folders).toEqual([]);

		const folder = await ds.createFolder?.(null, "New");
		expect(folder?.name).toBe("New");
		expect(folder?.parentId).toBeNull();
	});
});

describe("AssetSourceStatus", () => {
	it("models the phase union including the error variant", () => {
		const statuses: readonly AssetSourceStatus[] = [
			{ phase: "idle" },
			{ phase: "loading" },
			{ phase: "paginating", loaded: 24 },
			{ phase: "mutating", op: "moveFolder", id: "a1" },
			{
				phase: "error",
				error: new AssetSourceError("DATA_SOURCE_TIMEOUT", "slow"),
			},
		];
		const errored = statuses.find((s) => s.phase === "error");
		expect(errored?.phase).toBe("error");
		if (errored?.phase === "error") {
			expect(errored.error).toBeInstanceOf(AssetSourceError);
			expect(errored.error.code).toBe("DATA_SOURCE_TIMEOUT");
		}
	});
});
