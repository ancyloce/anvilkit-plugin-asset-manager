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

	it("accepts data: URLs only when dataUrlAllowlistOptIn is true", () => {
		expect(() =>
			validateUploadResult({
				id: "asset-1",
				url: "data:image/png;base64,AAAA",
			}),
		).toThrow(AssetValidationError);

		expect(
			validateUploadResult(
				{
					id: "asset-1",
					url: "data:image/png;base64,AAAA",
				},
				{ dataUrlAllowlistOptIn: true },
			),
		).toMatchObject({
			id: "asset-1",
			url: "data:image/png;base64,AAAA",
		});
	});

	it("rejects path-traversal sequences (literal and percent-encoded)", () => {
		for (const url of [
			"https://cdn.example.com/../etc/passwd",
			"https://cdn.example.com/%2e%2e/etc/passwd",
			"https://cdn.example.com/%2E%2E%2Fetc/passwd",
			"https://cdn.example.com/safe/..%2fetc/passwd",
			"http://localhost/uploads/../../secret",
			"blob:https://studio.example.com/abc/../def",
		]) {
			expect(() =>
				validateUploadResult({
					id: "asset-1",
					url,
				}),
			).toThrowError(/path-traversal/i);
		}
	});

	it("rejects mixed-script hostnames as a homoglyph guard", () => {
		// "аpple.com" — Cyrillic 'а' (U+0430) followed by Latin "pple.com".
		const homoglyphHost = "https://аpple.com/img.png";
		expect(() =>
			validateUploadResult({
				id: "asset-1",
				url: homoglyphHost,
			}),
		).toThrowError(/visually confusable script/);
	});

	it("permits single-script IDN hostnames", () => {
		// münchen.de — Latin extended only.
		expect(
			validateUploadResult({
				id: "asset-1",
				url: "https://münchen.de/img.png",
			}),
		).toMatchObject({ id: "asset-1" });

		// 日本.jp — Han only.
		expect(
			validateUploadResult({
				id: "asset-2",
				url: "https://日本.jp/img.png",
			}),
		).toMatchObject({ id: "asset-2" });
	});

	it("permits mixed-script hostnames when allowMixedScriptHostnames is true", () => {
		const homoglyphHost = "https://аpple.com/img.png";
		expect(
			validateUploadResult(
				{ id: "asset-1", url: homoglyphHost },
				{ allowMixedScriptHostnames: true },
			),
		).toMatchObject({ id: "asset-1" });
	});

	it("does not run hostname checks on blob: URLs", () => {
		// blob: pseudo-hostnames are not real hosts; the IDN guard must
		// not fire on them.
		expect(
			validateUploadResult({
				id: "asset-1",
				url: "blob:https://studio.example.com/abcd",
			}),
		).toMatchObject({ id: "asset-1" });
	});
});
