import { describe, expect, it, vi } from "vitest";

import type { UploadPart, UploadSession } from "../types/resumable.js";
import { getRequiredCsp } from "../utils/csp.js";
import { s3MultipartAdapter } from "./s3-multipart.js";

const ENDPOINT = "https://broker.example/mp";
const MiB = 1024 * 1024;

function res(
	status: number,
	body?: unknown,
	headers?: Record<string, string>,
): Response {
	return new Response(body === undefined ? null : JSON.stringify(body), {
		status,
		...(headers ? { headers } : {}),
	});
}

interface Routes {
	action: (body: Record<string, unknown>) => Response | Promise<Response>;
	put?: (url: string, init: RequestInit) => Response | Promise<Response>;
}

function makeFetch(routes: Routes) {
	const actions: Record<string, unknown>[] = [];
	const fetchImpl = vi.fn(
		async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url === ENDPOINT) {
				const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
				actions.push(body);
				return routes.action(body);
			}
			return routes.put
				? routes.put(url, init ?? {})
				: res(200, undefined, { etag: '"etag-default"' });
		},
	) as unknown as typeof globalThis.fetch;
	return { fetchImpl, actions };
}

function makeFile(): File {
	return new File(["hello"], "clip.bin", { type: "video/mp4" });
}

const part2: UploadPart = {
	partNumber: 2,
	start: 0,
	end: 5,
	blob: new Blob(["world"]),
};

describe("s3MultipartAdapter.begin", () => {
	it("creates a fresh session and carries file metadata", async () => {
		const { fetchImpl, actions } = makeFetch({
			action: () =>
				res(200, { uploadId: "mpu-1", key: "uploads/x", partSize: 8 * MiB }),
		});
		const adapter = s3MultipartAdapter({
			endpoint: ENDPOINT,
			fetch: fetchImpl,
		});

		const session = await adapter.begin(makeFile());

		expect(actions[0]?.action).toBe("create");
		expect(session.uploadId).toBe("mpu-1");
		expect(session.parts).toEqual([]);
		expect(session.partSize).toBe(8 * MiB);
		expect(session.meta).toMatchObject({
			key: "uploads/x",
			name: "clip.bin",
			size: 5,
			type: "video/mp4",
		});
	});

	it("clamps the part size up to S3's 5 MiB minimum", async () => {
		const { fetchImpl, actions } = makeFetch({
			action: () => res(200, { uploadId: "m" }),
		});
		const adapter = s3MultipartAdapter({
			endpoint: ENDPOINT,
			fetch: fetchImpl,
			partSize: 1024,
		});

		const session = await adapter.begin(makeFile());

		expect(actions[0]?.partSize).toBe(5 * MiB);
		expect(session.partSize).toBe(5 * MiB);
	});

	it("resumes via list-parts, echoing the locked part size", async () => {
		const { fetchImpl, actions } = makeFetch({
			action: () => res(200, { parts: [{ partNumber: 1, etag: '"e1"' }] }),
		});
		const adapter = s3MultipartAdapter({
			endpoint: ENDPOINT,
			fetch: fetchImpl,
		});

		const session = await adapter.begin(makeFile(), {
			uploadId: "mpu-resume",
			partSize: 7 * MiB,
			parts: [{ partNumber: 1, etag: '"e1"' }],
			meta: { key: "uploads/x" },
		});

		expect(actions[0]?.action).toBe("list-parts");
		expect(session.uploadId).toBe("mpu-resume");
		expect(session.parts).toEqual([{ partNumber: 1, etag: '"e1"' }]);
		expect(session.partSize).toBe(7 * MiB);
		expect(session.meta).toMatchObject({ key: "uploads/x" });
	});

	it("starts fresh when the resumed MPU is gone (list-parts 404)", async () => {
		const { fetchImpl, actions } = makeFetch({
			action: (b) =>
				b.action === "list-parts"
					? res(404, { error: "NoSuchUpload" })
					: res(200, { uploadId: "mpu-new" }),
		});
		const adapter = s3MultipartAdapter({
			endpoint: ENDPOINT,
			fetch: fetchImpl,
		});

		const session = await adapter.begin(makeFile(), {
			uploadId: "gone",
			partSize: 8 * MiB,
			parts: [{ partNumber: 1, etag: '"e1"' }],
			meta: {},
		});

		expect(actions.map((a) => a.action)).toEqual(["list-parts", "create"]);
		expect(session.uploadId).toBe("mpu-new");
		expect(session.parts).toEqual([]);
	});

	it("retries a transient 5xx then succeeds", async () => {
		let n = 0;
		const { fetchImpl } = makeFetch({
			action: () => {
				n += 1;
				return n === 1
					? res(503, { error: "slow" })
					: res(200, { uploadId: "m" });
			},
		});
		const adapter = s3MultipartAdapter({
			endpoint: ENDPOINT,
			fetch: fetchImpl,
			retry: { sleep: () => Promise.resolve(), jitter: () => 0 },
		});

		const session = await adapter.begin(makeFile());
		expect(session.uploadId).toBe("m");
		expect(n).toBe(2);
	});

	it("does not retry a 4xx and surfaces an AssetValidationError", async () => {
		let n = 0;
		const { fetchImpl } = makeFetch({
			action: () => {
				n += 1;
				return res(400, { error: "bad request" });
			},
		});
		const adapter = s3MultipartAdapter({
			endpoint: ENDPOINT,
			fetch: fetchImpl,
			retry: { sleep: () => Promise.resolve(), jitter: () => 0 },
		});

		await expect(adapter.begin(makeFile())).rejects.toMatchObject({
			name: "AssetValidationError",
		});
		expect(n).toBe(1);
	});
});

describe("s3MultipartAdapter.uploadPart", () => {
	const session: UploadSession = {
		uploadId: "mpu-1",
		parts: [],
		partSize: 8 * MiB,
		meta: { key: "uploads/x" },
	};

	it("signs the part then PUTs it and returns the ETag", async () => {
		const { fetchImpl, actions } = makeFetch({
			action: () => res(200, { url: "https://bucket.example/p2?sig" }),
			put: (url) => {
				expect(url).toBe("https://bucket.example/p2?sig");
				return res(200, undefined, { etag: '"etag-2"' });
			},
		});
		const adapter = s3MultipartAdapter({
			endpoint: ENDPOINT,
			fetch: fetchImpl,
		});

		const tag = await adapter.uploadPart(session, part2);

		expect(actions[0]).toMatchObject({
			action: "sign-part",
			uploadId: "mpu-1",
			key: "uploads/x",
			partNumber: 2,
		});
		expect(tag).toEqual({ partNumber: 2, etag: '"etag-2"' });
	});

	it("fails clearly when the PUT response exposes no ETag", async () => {
		const { fetchImpl } = makeFetch({
			action: () => res(200, { url: "https://bucket.example/p2?sig" }),
			put: () => res(200, undefined, {}),
		});
		const adapter = s3MultipartAdapter({
			endpoint: ENDPOINT,
			fetch: fetchImpl,
		});

		await expect(adapter.uploadPart(session, part2)).rejects.toThrow(/ETag/);
	});
});

describe("s3MultipartAdapter.complete / abort", () => {
	const session: UploadSession = {
		uploadId: "mpu-1",
		parts: [],
		partSize: 8 * MiB,
		meta: { key: "uploads/x", name: "clip.bin", size: 5, type: "video/mp4" },
	};

	it("completes and returns the public URL + carried metadata", async () => {
		const { fetchImpl, actions } = makeFetch({
			action: () =>
				res(200, {
					url: "https://bucket.example/x?sig",
					publicUrl: "https://cdn.example/x",
					id: "asset-9",
				}),
		});
		const adapter = s3MultipartAdapter({
			endpoint: ENDPOINT,
			fetch: fetchImpl,
		});

		const result = await adapter.complete(session, [
			{ partNumber: 1, etag: '"e1"' },
		]);

		expect(actions[0]).toMatchObject({
			action: "complete",
			uploadId: "mpu-1",
			parts: [{ partNumber: 1, etag: '"e1"' }],
		});
		expect(result).toEqual({
			id: "asset-9",
			url: "https://cdn.example/x",
			name: "clip.bin",
			meta: { size: 5, mimeType: "video/mp4" },
		});
	});

	it("strips query when no publicUrl and generates an id", async () => {
		const { fetchImpl } = makeFetch({
			action: () => res(200, { url: "https://bucket.example/x?sig=abc" }),
		});
		const adapter = s3MultipartAdapter({
			endpoint: ENDPOINT,
			fetch: fetchImpl,
			idGenerator: () => "gen-id",
		});

		const result = await adapter.complete(session, []);
		expect(result.id).toBe("gen-id");
		expect(result.url).toBe("https://bucket.example/x");
	});

	it("posts the abort action", async () => {
		const { fetchImpl, actions } = makeFetch({
			action: () => res(200, undefined, {}),
		});
		const adapter = s3MultipartAdapter({
			endpoint: ENDPOINT,
			fetch: fetchImpl,
		});

		await adapter.abort(session);
		expect(actions[0]).toMatchObject({ action: "abort", uploadId: "mpu-1" });
	});
});

describe("getRequiredCsp — s3Multipart", () => {
	it("adds the broker endpoint, bucket, and public origins", () => {
		const csp = getRequiredCsp({
			s3Multipart: {
				endpoint: "https://broker.example/mp",
				bucketHost: "https://bucket.example",
				publicHost: "https://cdn.example",
			},
		});
		expect(csp.connectSrc).toEqual(
			expect.arrayContaining([
				"https://broker.example",
				"https://bucket.example",
				"https://cdn.example",
			]),
		);
		expect(csp.imgSrc).toContain("https://cdn.example");
		expect(csp.mediaSrc).toContain("https://cdn.example");
	});

	it("serves from the bucket origin when no publicHost is given", () => {
		const csp = getRequiredCsp({
			s3Multipart: {
				endpoint: "https://broker.example/mp",
				bucketHost: "https://bucket.example",
			},
		});
		expect(csp.imgSrc).toEqual(["https://bucket.example"]);
		expect(csp.mediaSrc).toEqual(["https://bucket.example"]);
	});
});

describe("s3MultipartAdapter retry split + header forwarding", () => {
	const session: UploadSession = {
		uploadId: "mpu-1",
		parts: [],
		partSize: 8 * MiB,
		meta: { key: "uploads/x" },
	};

	it("forwards the broker's signed headers to the part PUT", async () => {
		let putHeaders: HeadersInit | undefined;
		const { fetchImpl } = makeFetch({
			action: () =>
				res(200, {
					url: "https://bucket.example/p2?sig",
					headers: { "x-amz-server-side-encryption": "AES256" },
				}),
			put: (_url, init) => {
				putHeaders = init.headers;
				return res(200, undefined, { etag: '"e2"' });
			},
		});
		const adapter = s3MultipartAdapter({
			endpoint: ENDPOINT,
			fetch: fetchImpl,
		});

		await adapter.uploadPart(session, part2);
		expect(putHeaders).toMatchObject({
			"x-amz-server-side-encryption": "AES256",
		});
	});

	it("does NOT retry uploadPart internally — one sign attempt then RetryableError", async () => {
		let signCalls = 0;
		let putCalls = 0;
		const { fetchImpl } = makeFetch({
			action: () => {
				signCalls += 1;
				return res(503, { error: "slow" });
			},
			put: () => {
				putCalls += 1;
				return res(200, undefined, { etag: '"e"' });
			},
		});
		const adapter = s3MultipartAdapter({
			endpoint: ENDPOINT,
			fetch: fetchImpl,
			retry: { sleep: () => Promise.resolve(), jitter: () => 0 },
		});

		await expect(adapter.uploadPart(session, part2)).rejects.toMatchObject({
			name: "RetryableError",
		});
		expect(signCalls).toBe(1); // runner owns retry, not the adapter
		expect(putCalls).toBe(0);
	});

	it("retries complete internally on a transient 5xx", async () => {
		let n = 0;
		const { fetchImpl } = makeFetch({
			action: () => {
				n += 1;
				return n === 1
					? res(503, { error: "slow" })
					: res(200, { url: "https://bucket.example/x" });
			},
		});
		const adapter = s3MultipartAdapter({
			endpoint: ENDPOINT,
			fetch: fetchImpl,
			retry: { sleep: () => Promise.resolve(), jitter: () => 0 },
		});

		await adapter.complete(session, [{ partNumber: 1, etag: '"e1"' }]);
		expect(n).toBe(2);
	});

	it("retries abort internally on a transient 5xx", async () => {
		let n = 0;
		const { fetchImpl } = makeFetch({
			action: () => {
				n += 1;
				return n === 1 ? res(503, { error: "slow" }) : res(200, undefined, {});
			},
		});
		const adapter = s3MultipartAdapter({
			endpoint: ENDPOINT,
			fetch: fetchImpl,
			retry: { sleep: () => Promise.resolve(), jitter: () => 0 },
		});

		await adapter.abort(session);
		expect(n).toBe(2);
	});
});

describe("s3MultipartAdapter broker shape validation", () => {
	const session: UploadSession = {
		uploadId: "mpu-1",
		parts: [],
		partSize: 8 * MiB,
		meta: { key: "uploads/x" },
	};

	it("rejects malformed sign-part headers", async () => {
		const { fetchImpl } = makeFetch({
			action: () =>
				res(200, { url: "https://bucket.example/p2?sig", headers: { x: 5 } }),
		});
		const adapter = s3MultipartAdapter({
			endpoint: ENDPOINT,
			fetch: fetchImpl,
		});
		await expect(adapter.uploadPart(session, part2)).rejects.toMatchObject({
			name: "AssetValidationError",
		});
	});

	it("rejects a non-positive create partSize", async () => {
		const { fetchImpl } = makeFetch({
			action: () => res(200, { uploadId: "m", partSize: -5 }),
		});
		const adapter = s3MultipartAdapter({
			endpoint: ENDPOINT,
			fetch: fetchImpl,
		});
		await expect(adapter.begin(makeFile())).rejects.toMatchObject({
			name: "AssetValidationError",
		});
	});

	it("rejects a non-string complete id", async () => {
		const { fetchImpl } = makeFetch({
			action: () => res(200, { url: "https://bucket.example/x", id: 42 }),
		});
		const adapter = s3MultipartAdapter({
			endpoint: ENDPOINT,
			fetch: fetchImpl,
		});
		await expect(adapter.complete(session, [])).rejects.toMatchObject({
			name: "AssetValidationError",
		});
	});

	it("rejects a malformed list-parts parts array on resume", async () => {
		const { fetchImpl } = makeFetch({
			action: () => res(200, { parts: [{ partNumber: "1", etag: "e" }] }),
		});
		const adapter = s3MultipartAdapter({
			endpoint: ENDPOINT,
			fetch: fetchImpl,
		});
		await expect(
			adapter.begin(makeFile(), {
				uploadId: "mpu-resume",
				partSize: 8 * MiB,
				parts: [{ partNumber: 1, etag: "e" }],
				meta: { key: "uploads/x" },
			}),
		).rejects.toMatchObject({ name: "AssetValidationError" });
	});
});
