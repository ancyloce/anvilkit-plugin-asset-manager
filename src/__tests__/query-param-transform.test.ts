import { describe, expect, it } from "vitest";

import type { UploadResult } from "../types/types.js";
import {
	createQueryParamTransformResolver,
	deriveVariantUrl,
} from "../utils/query-param-transform.js";

const asset = (url: string): UploadResult => ({ id: "a1", url });

describe("createQueryParamTransformResolver", () => {
	it("maps every transform field to imgix-style params by default", () => {
		const resolve = createQueryParamTransformResolver();
		const url = resolve(asset("https://cdn.example/a.png"), {
			width: 400,
			height: 300,
			fit: "cover",
			format: "webp",
			quality: 80,
			dpr: 2,
		});
		const u = new URL(url as string);
		expect(u.origin + u.pathname).toBe("https://cdn.example/a.png");
		expect(Object.fromEntries(u.searchParams)).toEqual({
			w: "400",
			h: "300",
			fit: "cover",
			fm: "webp",
			q: "80",
			dpr: "2",
		});
	});

	it("omits unset fields", () => {
		const resolve = createQueryParamTransformResolver();
		const url = new URL(
			resolve(asset("https://cdn.example/a.png"), {
				width: 200,
			}) as string,
		);
		expect(Object.fromEntries(url.searchParams)).toEqual({ w: "200" });
	});

	it("returns undefined for an empty transform (falls back to original)", () => {
		const resolve = createQueryParamTransformResolver();
		expect(resolve(asset("https://cdn.example/a.png"), {})).toBeUndefined();
	});

	it("preserves an existing query on the asset URL", () => {
		const resolve = createQueryParamTransformResolver();
		const url = new URL(
			resolve(asset("https://cdn.example/a.png?v=7"), {
				width: 100,
			}) as string,
		);
		expect(url.searchParams.get("v")).toBe("7");
		expect(url.searchParams.get("w")).toBe("100");
	});

	it("honors custom param names and fit/format maps", () => {
		const resolve = createQueryParamTransformResolver({
			params: { width: "width", format: "f" },
			fitMap: { cover: "crop" },
			formatMap: { webp: "wbp" },
		});
		const url = new URL(
			resolve(asset("https://cdn.example/a.png"), {
				width: 320,
				fit: "cover",
				format: "webp",
			}) as string,
		);
		expect(url.searchParams.get("width")).toBe("320");
		expect(url.searchParams.get("fit")).toBe("crop");
		expect(url.searchParams.get("f")).toBe("wbp");
	});

	it("appends to a relative URL via string fallback", () => {
		const resolve = createQueryParamTransformResolver();
		expect(resolve(asset("/img/a.png"), { width: 100 })).toBe(
			"/img/a.png?w=100",
		);
		expect(resolve(asset("/img/a.png?x=1"), { width: 100 })).toBe(
			"/img/a.png?x=1&w=100",
		);
	});

	it("keeps the query before the fragment for relative URLs", () => {
		const resolve = createQueryParamTransformResolver();
		expect(resolve(asset("/img/a.png#v"), { width: 100 })).toBe(
			"/img/a.png?w=100#v",
		);
		expect(resolve(asset("/img/a.png?x=1#v"), { width: 100 })).toBe(
			"/img/a.png?x=1&w=100#v",
		);
	});

	it("replaces a same-name param (relative + absolute behave alike)", () => {
		const resolve = createQueryParamTransformResolver();
		expect(resolve(asset("/img/a.png?w=50"), { width: 100 })).toBe(
			"/img/a.png?w=100",
		);
		const abs = new URL(
			resolve(asset("https://cdn.example/a.png?w=50"), {
				width: 100,
			}) as string,
		);
		expect(abs.searchParams.getAll("w")).toEqual(["100"]);
	});

	it("keeps the query before the fragment for absolute URLs", () => {
		const resolve = createQueryParamTransformResolver();
		const url = resolve(asset("https://cdn.example/a.png#v"), { width: 100 });
		expect(url).toBe("https://cdn.example/a.png?w=100#v");
	});
});

describe("deriveVariantUrl", () => {
	it("returns the resolver's URL, or the original on undefined", () => {
		const a = asset("https://cdn.example/a.png");
		expect(
			deriveVariantUrl(a, { width: 100 }, createQueryParamTransformResolver()),
		).toBe("https://cdn.example/a.png?w=100");
		expect(deriveVariantUrl(a, {}, createQueryParamTransformResolver())).toBe(
			"https://cdn.example/a.png",
		);
		expect(deriveVariantUrl(a, { width: 100 }, () => undefined)).toBe(
			"https://cdn.example/a.png",
		);
	});
});
