import { describe, expect, it } from "vitest";

import { createTestRegistry, fakeUploader } from "../index.js";

describe("createTestRegistry", () => {
	it("returns an empty registry by default", () => {
		const registry = createTestRegistry();
		expect(registry.list()).toEqual([]);
	});

	it("seeds the registry with initial entries", () => {
		const registry = createTestRegistry({
			initial: [
				{
					id: "a",
					url: "https://cdn.example.com/a.png",
					meta: { mimeType: "image/png", size: 1 },
				},
				{
					id: "b",
					url: "https://cdn.example.com/b.png",
					meta: { mimeType: "image/png", size: 2 },
				},
			],
		});
		expect(registry.list().map((entry) => entry.id)).toEqual(["a", "b"]);
	});
});

describe("fakeUploader", () => {
	it("returns a synthetic UploadResult derived from the file", async () => {
		const upload = fakeUploader();
		const result = await upload(
			new File(["hello"], "cover image.png", { type: "image/png" }),
		);
		expect(result.id).toBe("asset-cover-image-png");
		expect(result.url).toBe("https://test.local/cover%20image.png");
		expect(result.name).toBe("cover image.png");
		expect(result.meta?.mimeType).toBe("image/png");
		expect(result.meta?.size).toBe(5);
	});

	it("returns canned responses when the file name matches the responses map", async () => {
		const canned = {
			id: "canned-1",
			url: "https://cdn.example.com/canned.png",
			name: "canned.png",
		};
		const upload = fakeUploader({ responses: { "canned.png": canned } });
		const result = await upload(
			new File(["x"], "canned.png", { type: "image/png" }),
		);
		expect(result).toBe(canned);
	});

	it("preserves a missing MIME type instead of fabricating one", async () => {
		const upload = fakeUploader();
		const result = await upload(new File(["x"], "blob", { type: "" }));
		expect(result.meta?.mimeType).toBeUndefined();
	});
});
