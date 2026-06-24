import { describe, expect, it } from "vitest";

import {
	isResumableAdapter,
	type ResumableUploadAdapter,
} from "../types/resumable.js";
import type { UploadAdapter } from "../types/types.js";

const resumableAdapter: ResumableUploadAdapter = {
	begin: () => Promise.resolve({ uploadId: "u1" }),
	uploadPart: (_session, part) =>
		Promise.resolve({ partNumber: part.partNumber, etag: "e" }),
	complete: () => Promise.resolve({ id: "a1", url: "https://cdn/a1" }),
	abort: () => Promise.resolve(),
};

const singleShotAdapter: UploadAdapter = () =>
	Promise.resolve({ id: "a1", url: "https://cdn/a1" });

describe("isResumableAdapter", () => {
	it("accepts an object exposing all four lifecycle methods", () => {
		expect(isResumableAdapter(resumableAdapter)).toBe(true);
	});

	it("rejects the single-shot function adapter", () => {
		expect(isResumableAdapter(singleShotAdapter)).toBe(false);
	});

	it("rejects undefined", () => {
		expect(isResumableAdapter(undefined)).toBe(false);
	});

	it("rejects a partial adapter missing a method", () => {
		const partial = {
			begin: resumableAdapter.begin,
			uploadPart: resumableAdapter.uploadPart,
			complete: resumableAdapter.complete,
			// abort intentionally omitted
		} as unknown as ResumableUploadAdapter;
		expect(isResumableAdapter(partial)).toBe(false);
	});
});
