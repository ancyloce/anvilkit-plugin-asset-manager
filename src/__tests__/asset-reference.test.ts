import { describe, expect, it } from "vitest";

import type { AssetTransform } from "../types/transform.js";
import {
	createAssetReference,
	parseAssetReference,
} from "../utils/asset-reference.js";

describe("createAssetReference / parseAssetReference", () => {
	it("round-trips a plain id with no transform", () => {
		expect(createAssetReference("abc")).toBe("asset://abc");
		expect(parseAssetReference("asset://abc")).toEqual({ id: "abc" });
	});

	it("encodes and round-trips a full transform", () => {
		const transform: AssetTransform = {
			width: 800,
			height: 600,
			fit: "cover",
			format: "webp",
			quality: 80,
			dpr: 2,
		};
		const ref = createAssetReference("abc", transform);
		// Stable, ordered encoding (w,h,fit,fm,q,dpr).
		expect(ref).toBe("asset://abc?w=800&h=600&fit=cover&fm=webp&q=80&dpr=2");
		expect(parseAssetReference(ref)).toEqual({ id: "abc", transform });
	});

	it("keeps common ids (uuid, unsplash:, up-file) byte-identical (back-compat)", () => {
		for (const id of [
			"550e8400-e29b-41d4-a716-446655440000",
			"unsplash:abc123",
			"up-photo.png",
		]) {
			expect(createAssetReference(id)).toBe(`asset://${id}`);
			expect(parseAssetReference(`asset://${id}`)).toEqual({ id });
		}
	});

	it("round-trips ids containing query/fragment delimiters", () => {
		for (const id of ["a?b", "x#frag", "weird%3F", "a?b#c"]) {
			const ref = createAssetReference(id);
			expect(ref.includes("?")).toBe(false); // delimiters escaped in the id
			expect(parseAssetReference(ref)).toEqual({ id });
			// …and still works with a transform appended.
			expect(
				parseAssetReference(createAssetReference(id, { width: 100 })),
			).toEqual({ id, transform: { width: 100 } });
		}
	});

	it("rejects out-of-contract numeric transform values", () => {
		// quality > 100, non-integer dimensions are dropped.
		expect(parseAssetReference("asset://abc?q=1000")).toEqual({ id: "abc" });
		expect(parseAssetReference("asset://abc?w=12.5")).toEqual({ id: "abc" });
		// dpr may be fractional.
		expect(parseAssetReference("asset://abc?dpr=1.5")).toEqual({
			id: "abc",
			transform: { dpr: 1.5 },
		});
	});

	it("rejects non-decimal numeric syntax (1e3, 0x10)", () => {
		// Number() would coerce these; the decimal-only guard must reject them.
		expect(parseAssetReference("asset://abc?w=1e3")).toEqual({ id: "abc" });
		expect(parseAssetReference("asset://abc?q=0x10")).toEqual({ id: "abc" });
		expect(parseAssetReference("asset://abc?dpr=1e2")).toEqual({ id: "abc" });
	});

	it("rejects digit strings that overflow to Infinity", () => {
		const huge = "9".repeat(400); // passes /^[0-9]+$/ but Number(...) → Infinity
		expect(parseAssetReference(`asset://abc?w=${huge}`)).toEqual({ id: "abc" });
	});

	it("encodes only the provided transform fields", () => {
		const ref = createAssetReference("abc", { width: 400, format: "avif" });
		expect(parseAssetReference(ref)).toEqual({
			id: "abc",
			transform: { width: 400, format: "avif" },
		});
	});

	it("omits the query for an empty transform object", () => {
		expect(createAssetReference("abc", {})).toBe("asset://abc");
	});

	it("returns null for non-asset URLs and empty ids", () => {
		expect(parseAssetReference("https://cdn/x.png")).toBeNull();
		expect(parseAssetReference("asset://")).toBeNull();
		expect(parseAssetReference("asset://?w=100")).toBeNull();
	});

	it("ignores malformed transform params rather than failing", () => {
		// Non-numeric width + unknown fit/format are dropped; the id still parses.
		expect(parseAssetReference("asset://abc?w=nope&fit=wonky&fm=gif")).toEqual({
			id: "abc",
		});
		// Mixed valid + invalid keeps only the valid fields.
		expect(
			parseAssetReference("asset://abc?w=300&h=-5&q=0&fit=contain"),
		).toEqual({ id: "abc", transform: { width: 300, fit: "contain" } });
	});
});
