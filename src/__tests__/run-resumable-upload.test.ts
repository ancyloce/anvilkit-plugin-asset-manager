import { describe, expect, it, vi } from "vitest";

import type {
	PartTag,
	PersistedUploadSession,
	ResumableUploadAdapter,
} from "../types/resumable.js";
import { RetryableError } from "../utils/retry.js";
import {
	type ResumableUploadProgress,
	runResumableUpload,
} from "../utils/run-resumable-upload.js";
import { createUploadSessionStore } from "../utils/upload-session-store.js";

function makeFile(bytes: number): File {
	return new File(["x".repeat(bytes)], "video.mp4", { lastModified: 1 });
}

interface AdapterSpy {
	readonly adapter: ResumableUploadAdapter;
	readonly beginResumes: (PersistedUploadSession | undefined)[];
	readonly partCalls: number[];
	readonly completeCalls: (readonly PartTag[])[];
	readonly state: { abortCalls: number; abortSawSignal: boolean };
}

function spyAdapter(
	opts: {
		readonly partSize?: number;
		readonly echoResume?: boolean;
		readonly uploadPart?: (partNumber: number) => Promise<PartTag>;
	} = {},
): AdapterSpy {
	const beginResumes: (PersistedUploadSession | undefined)[] = [];
	const partCalls: number[] = [];
	const completeCalls: (readonly PartTag[])[] = [];
	const state = { abortCalls: 0, abortSawSignal: false };

	const adapter: ResumableUploadAdapter = {
		begin: (_file, resume) => {
			beginResumes.push(resume);
			return Promise.resolve({
				uploadId: resume?.uploadId ?? "mpu",
				parts: opts.echoResume ? (resume?.parts ?? []) : [],
				...(opts.partSize ? { partSize: opts.partSize } : {}),
			});
		},
		uploadPart: (_session, part) => {
			partCalls.push(part.partNumber);
			if (opts.uploadPart) return opts.uploadPart(part.partNumber);
			return Promise.resolve({
				partNumber: part.partNumber,
				etag: `etag-${part.partNumber}`,
			});
		},
		complete: (_session, parts) => {
			completeCalls.push(parts);
			return Promise.resolve({
				id: "asset-1",
				url: "https://cdn.example/asset-1",
			});
		},
		abort: (_session, abortOptions) => {
			state.abortCalls += 1;
			if (abortOptions?.signal !== undefined) state.abortSawSignal = true;
			return Promise.resolve();
		},
	};

	return { adapter, beginResumes, partCalls, completeCalls, state };
}

// Deterministic, delay-free retry config for tests that exercise withRetry.
const fastRetry = { sleep: () => Promise.resolve(), jitter: () => 0 } as const;

describe("runResumableUpload", () => {
	it("uploads every part of a fresh file in order and completes", async () => {
		const spy = spyAdapter();
		const store = createUploadSessionStore({ storage: memStorage() });
		const file = makeFile(30);

		const result = await runResumableUpload(spy.adapter, file, {
			partSize: 10,
			sessionStore: store,
		});

		expect(spy.partCalls).toEqual([1, 2, 3]);
		expect(spy.completeCalls).toHaveLength(1);
		expect(spy.completeCalls[0]).toEqual([
			{ partNumber: 1, etag: "etag-1" },
			{ partNumber: 2, etag: "etag-2" },
			{ partNumber: 3, etag: "etag-3" },
		]);
		expect(result).toEqual({
			id: "asset-1",
			url: "https://cdn.example/asset-1",
		});
		// Session is cleared on success.
		expect(store.load(file)).toBeUndefined();
	});

	it("resumes from persisted parts and only uploads what is missing", async () => {
		const storage = memStorage();
		const store = createUploadSessionStore({ storage });
		const file = makeFile(30);
		const persisted: PersistedUploadSession = {
			uploadId: "mpu-resume",
			partSize: 10,
			parts: [{ partNumber: 1, etag: "etag-1" }],
		};
		store.save(file, persisted);

		const spy = spyAdapter({ echoResume: true, partSize: 10 });
		await runResumableUpload(spy.adapter, file, {
			partSize: 10,
			sessionStore: store,
		});

		// begin received the persisted resume handle.
		expect(spy.beginResumes[0]?.uploadId).toBe("mpu-resume");
		// Only parts 2 and 3 were uploaded; part 1 was skipped.
		expect(spy.partCalls).toEqual([2, 3]);
		expect(spy.completeCalls[0]).toEqual([
			{ partNumber: 1, etag: "etag-1" },
			{ partNumber: 2, etag: "etag-2" },
			{ partNumber: 3, etag: "etag-3" },
		]);
	});

	it("retries a transient part failure (retry-by-part)", async () => {
		const attempts = new Map<number, number>();
		const spy = spyAdapter({
			uploadPart: (partNumber) => {
				const n = (attempts.get(partNumber) ?? 0) + 1;
				attempts.set(partNumber, n);
				if (partNumber === 2 && n === 1) {
					return Promise.reject(new RetryableError("transient 503"));
				}
				return Promise.resolve({ partNumber, etag: `etag-${partNumber}` });
			},
		});
		const file = makeFile(30);

		await runResumableUpload(spy.adapter, file, {
			partSize: 10,
			sessionStore: createUploadSessionStore({ storage: memStorage() }),
			retry: fastRetry,
		});

		// Part 2 was attempted twice (fail then success).
		expect(attempts.get(2)).toBe(2);
		expect(spy.partCalls.filter((p) => p === 2)).toHaveLength(2);
		expect(spy.completeCalls).toHaveLength(1);
	});

	it("aborts the backend session and clears the store on abort", async () => {
		const controller = new AbortController();
		const spy = spyAdapter({
			uploadPart: (partNumber) => {
				if (partNumber === 1) controller.abort(); // abort after first part
				return Promise.resolve({ partNumber, etag: `etag-${partNumber}` });
			},
		});
		const store = createUploadSessionStore({ storage: memStorage() });
		const file = makeFile(30);

		await expect(
			runResumableUpload(spy.adapter, file, {
				partSize: 10,
				signal: controller.signal,
				sessionStore: store,
			}),
		).rejects.toThrow();

		// Part 2 never started; backend session torn down; handle cleared.
		expect(spy.partCalls).toEqual([1]);
		expect(spy.state.abortCalls).toBe(1);
		// Teardown must NOT receive the already-aborted signal, or it would
		// cancel the abort request itself and dangle the backend session.
		expect(spy.state.abortSawSignal).toBe(false);
		expect(store.load(file)).toBeUndefined();
	});

	it("leaves the session persisted on a non-abort failure (resume later)", async () => {
		const spy = spyAdapter({
			uploadPart: (partNumber) => {
				if (partNumber === 2) {
					return Promise.reject(new Error("permanent 403"));
				}
				return Promise.resolve({ partNumber, etag: `etag-${partNumber}` });
			},
		});
		const store = createUploadSessionStore({ storage: memStorage() });
		const file = makeFile(30);

		await expect(
			runResumableUpload(spy.adapter, file, {
				partSize: 10,
				sessionStore: store,
			}),
		).rejects.toThrow("permanent 403");

		// No backend teardown; part 1 stays persisted for a later resume.
		expect(spy.state.abortCalls).toBe(0);
		const persisted = store.load(file) as PersistedUploadSession | undefined;
		expect(persisted?.parts).toEqual([{ partNumber: 1, etag: "etag-1" }]);
		expect(persisted?.partSize).toBe(10);
	});

	it("reports monotonic progress ending at 100%", async () => {
		const onProgress = vi.fn<(p: ResumableUploadProgress) => void>();
		const file = makeFile(25); // 10 + 10 + 5

		await runResumableUpload(spyAdapter().adapter, file, {
			partSize: 10,
			sessionStore: createUploadSessionStore({ storage: memStorage() }),
			onProgress,
		});

		const snaps = onProgress.mock.calls.map((c) => c[0]);
		// Initial (0) + one per completed part.
		expect(snaps[0]).toEqual({
			uploadedBytes: 0,
			totalBytes: 25,
			uploadedParts: 0,
			totalParts: 3,
		});
		expect(snaps.at(-1)).toEqual({
			uploadedBytes: 25,
			totalBytes: 25,
			uploadedParts: 3,
			totalParts: 3,
		});
		// uploadedBytes never decreases.
		for (let i = 1; i < snaps.length; i += 1) {
			expect(snaps[i].uploadedBytes).toBeGreaterThanOrEqual(
				snaps[i - 1].uploadedBytes,
			);
		}
	});

	it("rejects a resumed session that changes the locked part size", async () => {
		const storage = memStorage();
		const store = createUploadSessionStore({ storage });
		const file = makeFile(30);
		store.save(file, {
			uploadId: "mpu-resume",
			partSize: 10,
			parts: [{ partNumber: 1, etag: "etag-1" }],
		});
		// Adapter echoes resumed parts but reports a DIFFERENT part size.
		const spy = spyAdapter({ echoResume: true, partSize: 8 });

		await expect(
			runResumableUpload(spy.adapter, file, {
				partSize: 10,
				sessionStore: store,
			}),
		).rejects.toMatchObject({ code: "PART_SIZE_MISMATCH" });
		expect(spy.partCalls).toEqual([]);
	});

	it("rejects a non-positive part size instead of hanging", async () => {
		const spy = spyAdapter();
		await expect(
			runResumableUpload(spy.adapter, makeFile(30), {
				partSize: 0,
				sessionStore: createUploadSessionStore({ storage: memStorage() }),
			}),
		).rejects.toMatchObject({ code: "INVALID_PART_SIZE" });
	});

	it("ignores resumed part tags outside the current plan", async () => {
		const storage = memStorage();
		const store = createUploadSessionStore({ storage });
		const file = makeFile(30); // 3 parts at size 10
		store.save(file, {
			uploadId: "mpu-resume",
			partSize: 10,
			parts: [
				{ partNumber: 1, etag: "etag-1" },
				{ partNumber: 99, etag: "etag-99" }, // out of range
			],
		});
		const spy = spyAdapter({ echoResume: true, partSize: 10 });

		await runResumableUpload(spy.adapter, file, {
			partSize: 10,
			sessionStore: store,
		});

		// Part 1 resumed; 2 and 3 uploaded; the bogus part 99 is dropped from
		// both the upload set and the completion tags.
		expect(spy.partCalls).toEqual([2, 3]);
		expect(spy.completeCalls[0]).toEqual([
			{ partNumber: 1, etag: "etag-1" },
			{ partNumber: 2, etag: "etag-2" },
			{ partNumber: 3, etag: "etag-3" },
		]);
	});
});

function memStorage() {
	const map = new Map<string, string>();
	return {
		getItem: (k: string) => map.get(k) ?? null,
		setItem: (k: string, v: string) => {
			map.set(k, v);
		},
		removeItem: (k: string) => {
			map.delete(k);
		},
	};
}
