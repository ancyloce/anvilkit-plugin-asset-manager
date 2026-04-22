/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";

import { AssetValidationError } from "../errors.js";
import { dataUrlUploader } from "./data-url.js";

describe("dataUrlUploader", () => {
	it("encodes files as data URLs", async () => {
		const uploader = dataUrlUploader();
		const result = await uploader(
			new File(["hello"], "hello.txt", { type: "text/plain" }),
		);

		expect(result.id).toBe("asset-1");
		expect(result.url).toBe("data:text/plain;base64,aGVsbG8=");
		expect(atob(result.url.split(",")[1] ?? "")).toBe("hello");
	});

	it("rejects files larger than maxBytes", async () => {
		const uploader = dataUrlUploader({ maxBytes: 4 });

		await expect(
			uploader(new File(["hello"], "hello.txt", { type: "text/plain" })),
		).rejects.toBeInstanceOf(AssetValidationError);
	});
});
