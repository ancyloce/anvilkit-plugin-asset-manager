import { describe, expect, it } from "vitest";

import { inMemoryUploader } from "./in-memory.js";

describe("inMemoryUploader", () => {
	it("returns blob-backed metadata for uploaded files", async () => {
		const uploader = inMemoryUploader();
		const result = await uploader(
			new File(["hello"], "hello.txt", { type: "text/plain" }),
		);

		expect(result.id).toBe("asset-1");
		expect(result.url.startsWith("blob:")).toBe(true);
		expect(result.meta).toMatchObject({
			size: 5,
			mimeType: "text/plain",
		});
	});
});
