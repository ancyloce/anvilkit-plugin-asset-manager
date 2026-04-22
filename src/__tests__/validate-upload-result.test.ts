import { describe, expect, it } from "vitest";

import { AssetValidationError } from "../errors.js";
import { validateUploadResult } from "../validate-upload-result.js";

describe("validateUploadResult", () => {
	it("rejects hostile or malformed URLs", () => {
		for (const url of [
			"javascript:alert(1)",
			"data:text/html,<script>alert(1)</script>",
			"vbscript:msgbox(1)",
			"file:///etc/passwd",
			"",
			"ftp://cdn.example.com/asset.png",
		]) {
			expect(() =>
				validateUploadResult({
					id: "asset-1",
					url,
				}),
			).toThrow(AssetValidationError);
		}
	});

	it("accepts allowed absolute URLs", () => {
		expect(
			validateUploadResult({
				id: "asset-1",
				url: "https://cdn.example.com/img.png",
			}),
		).toMatchObject({
			id: "asset-1",
			url: "https://cdn.example.com/img.png",
		});

		expect(
			validateUploadResult({
				id: "asset-2",
				url: "http://localhost:3000/img.png",
			}),
		).toMatchObject({
			id: "asset-2",
			url: "http://localhost:3000/img.png",
		});

		expect(
			validateUploadResult({
				id: "asset-3",
				url: "blob:https://studio.example.com/1234",
			}),
		).toMatchObject({
			id: "asset-3",
			url: "blob:https://studio.example.com/1234",
		});
	});
});
