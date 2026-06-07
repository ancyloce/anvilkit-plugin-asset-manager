import type { StudioAssetUploadEvent } from "@anvilkit/core/types";
import { describe, expect, it } from "vitest";
import type { UploadResult } from "../types/types.js";
import { createAssetRegistry } from "../utils/registry.js";
import {
	createStudioAssetSource,
	MAX_CONCURRENT_UPLOADS,
} from "../utils/studio-asset-source.js";

interface Deferred<T> {
	readonly promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
	let resolveFn!: (value: T) => void;
	let rejectFn!: (reason: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolveFn = res;
		rejectFn = rej;
	});
	return { promise, resolve: resolveFn, reject: rejectFn };
}

function makeFile(name: string, bytes: number): File {
	const data = new Uint8Array(bytes);
	return new File([data], name, { type: "text/plain" });
}

function makeUpload(results: Array<Deferred<UploadResult>>): {
	readonly upload: (file: File) => Promise<UploadResult>;
	readonly inFlight: () => number;
	readonly callsByName: Map<string, number>;
} {
	let active = 0;
	const callsByName = new Map<string, number>();
	let i = 0;
	return {
		callsByName,
		inFlight: () => active,
		async upload(file) {
			active += 1;
			callsByName.set(file.name, (callsByName.get(file.name) ?? 0) + 1);
			const slot = results[i++];
			if (!slot) {
				active -= 1;
				throw new Error(`No deferred result for upload #${i}`);
			}
			try {
				return await slot.promise;
			} finally {
				active -= 1;
			}
		},
	};
}

describe("StudioAssetSource.upload concurrency", () => {
	it("caps in-flight uploads at MAX_CONCURRENT_UPLOADS=3 by default", async () => {
		const registry = createAssetRegistry();
		const slots = Array.from({ length: 5 }, () => deferred<UploadResult>());
		const { upload, inFlight } = makeUpload(slots);
		const source = createStudioAssetSource({ registry, upload });
		const files = [
			makeFile("a", 1),
			makeFile("b", 1),
			makeFile("c", 1),
			makeFile("d", 1),
			makeFile("e", 1),
		];

		const promise = source.upload(files);

		// Allow microtasks to schedule the first batch.
		await Promise.resolve();
		await Promise.resolve();
		expect(inFlight()).toBe(MAX_CONCURRENT_UPLOADS);

		// Resolve first three out-of-order; the next two should pick up.
		slots[2]!.resolve({ id: "a3", url: "https://x/a3" });
		slots[0]!.resolve({ id: "a1", url: "https://x/a1" });
		slots[1]!.resolve({ id: "a2", url: "https://x/a2" });

		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
		expect(inFlight()).toBeLessThanOrEqual(MAX_CONCURRENT_UPLOADS);

		slots[3]!.resolve({ id: "a4", url: "https://x/a4" });
		slots[4]!.resolve({ id: "a5", url: "https://x/a5" });

		const result = await promise;
		expect(result.map((a) => a.id)).toEqual(["a1", "a2", "a3", "a4", "a5"]);
	});

	it("preserves input ordering even when uploads complete out of order", async () => {
		const registry = createAssetRegistry();
		const slots = Array.from({ length: 4 }, () => deferred<UploadResult>());
		const { upload } = makeUpload(slots);
		const source = createStudioAssetSource({ registry, upload });
		const files = [
			makeFile("a", 1),
			makeFile("b", 1),
			makeFile("c", 1),
			makeFile("d", 1),
		];

		const promise = source.upload(files);

		// Resolve in reverse order.
		slots[3]!.resolve({ id: "d", url: "https://x/d" });
		slots[2]!.resolve({ id: "c", url: "https://x/c" });
		slots[1]!.resolve({ id: "b", url: "https://x/b" });
		slots[0]!.resolve({ id: "a", url: "https://x/a" });

		const result = await promise;
		expect(result.map((a) => a.id)).toEqual(["a", "b", "c", "d"]);
	});

	it("returns the successful subset on partial failure and reports errors via listener", async () => {
		const registry = createAssetRegistry();
		const slots = Array.from({ length: 3 }, () => deferred<UploadResult>());
		const { upload } = makeUpload(slots);
		const source = createStudioAssetSource({ registry, upload });
		const events: StudioAssetUploadEvent[] = [];

		const files = [makeFile("a", 1), makeFile("b", 1), makeFile("c", 1)];
		const promise = source.upload(files, (event) => events.push(event));

		slots[0]!.resolve({ id: "a", url: "https://x/a" });
		slots[1]!.reject(new Error("boom"));
		slots[2]!.resolve({ id: "c", url: "https://x/c" });

		const result = await promise;
		expect(result.map((a) => a.id)).toEqual(["a", "c"]);
		const errorEvents = events.filter((e) => e.type === "error");
		expect(errorEvents).toHaveLength(1);
		expect(errorEvents[0]).toMatchObject({ message: "boom" });
		const doneEvents = events.filter((e) => e.type === "done");
		expect(
			doneEvents.map((e) => (e.type === "done" ? e.asset.id : "")),
		).toEqual(["a", "c"]);
	});

	it("propagates AbortError and stops scheduling further work", async () => {
		const registry = createAssetRegistry();
		const slots = Array.from({ length: 5 }, () => deferred<UploadResult>());
		const { upload, callsByName } = makeUpload(slots);
		const source = createStudioAssetSource({ registry, upload });

		const files = [
			makeFile("a", 1),
			makeFile("b", 1),
			makeFile("c", 1),
			makeFile("d", 1),
			makeFile("e", 1),
		];
		const promise = source.upload(files);

		// First three are scheduled. Abort the second one.
		const abortError = Object.assign(new Error("aborted"), {
			name: "AbortError",
		});
		slots[1]!.reject(abortError);
		slots[0]!.resolve({ id: "a", url: "https://x/a" });
		slots[2]!.resolve({ id: "c", url: "https://x/c" });

		await expect(promise).rejects.toMatchObject({ name: "AbortError" });
		// `d` and `e` should never have been scheduled.
		expect(callsByName.get("d")).toBeUndefined();
		expect(callsByName.get("e")).toBeUndefined();
	});

	it("emits cumulative progress events monotonically", async () => {
		const registry = createAssetRegistry();
		const slots = Array.from({ length: 3 }, () => deferred<UploadResult>());
		const { upload } = makeUpload(slots);
		const source = createStudioAssetSource({ registry, upload });
		const events: StudioAssetUploadEvent[] = [];
		const files = [makeFile("a", 100), makeFile("b", 200), makeFile("c", 300)];
		const promise = source.upload(files, (event) => events.push(event));

		slots[0]!.resolve({ id: "a", url: "https://x/a" });
		slots[1]!.resolve({ id: "b", url: "https://x/b" });
		slots[2]!.resolve({ id: "c", url: "https://x/c" });

		await promise;
		const progressEvents = events.filter((e) => e.type === "progress");
		const progressBytes = progressEvents.map((e) =>
			e.type === "progress" ? e.bytesUploaded : 0,
		);
		// Monotonic, ending at total.
		for (let i = 1; i < progressBytes.length; i += 1) {
			expect(progressBytes[i]).toBeGreaterThanOrEqual(progressBytes[i - 1]!);
		}
		expect(progressBytes.at(-1)).toBe(600);
	});

	it("returns an empty array for zero-length input without invoking upload", async () => {
		const registry = createAssetRegistry();
		let invoked = 0;
		const source = createStudioAssetSource({
			registry,
			upload: async () => {
				invoked += 1;
				return { id: "x", url: "https://x" };
			},
		});
		const result = await source.upload([]);
		expect(result).toEqual([]);
		expect(invoked).toBe(0);
	});

	it("respects maxConcurrentUploads override", async () => {
		const registry = createAssetRegistry();
		const slots = Array.from({ length: 4 }, () => deferred<UploadResult>());
		const { upload, inFlight } = makeUpload(slots);
		const source = createStudioAssetSource({
			registry,
			upload,
			maxConcurrentUploads: 1,
		});
		const files = [
			makeFile("a", 1),
			makeFile("b", 1),
			makeFile("c", 1),
			makeFile("d", 1),
		];
		const promise = source.upload(files);

		await Promise.resolve();
		await Promise.resolve();
		expect(inFlight()).toBe(1);

		for (let i = 0; i < slots.length; i += 1) {
			slots[i]!.resolve({ id: `a${i}`, url: `https://x/${i}` });
			await Promise.resolve();
		}

		await promise;
	});

	it("a throwing upload subscriber/listener does not reject the batch (C1)", async () => {
		const registry = createAssetRegistry();
		let subscriberHits = 0;
		const source = createStudioAssetSource({
			registry,
			upload: async (file) => ({
				id: `up-${file.name}`,
				url: `blob:${file.name}`,
			}),
		});
		// Both delivery paths fault on every event: a `subscribeUploads`
		// subscriber and the inline `upload` listener.
		source.subscribeUploads(() => {
			subscriberHits += 1;
			throw new Error("subscriber boom");
		});
		const result = await source.upload([makeFile("a.txt", 1)], () => {
			throw new Error("inline listener boom");
		});
		// The batch still resolves with the uploaded asset despite both throwing.
		expect(result.map((a) => a.id)).toEqual(["up-a.txt"]);
		expect(subscriberHits).toBeGreaterThan(0); // the faulting subscriber WAS invoked
	});
});
