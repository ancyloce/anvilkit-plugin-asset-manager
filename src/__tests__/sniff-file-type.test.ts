import { describe, expect, it } from "vitest";

import {
	detectMimeFromBytes,
	sniffFileMime,
} from "../utils/sniff-file-type.js";

function bytes(...nums: number[]): Uint8Array {
	return new Uint8Array(nums);
}

const ascii = (text: string): number[] =>
	Array.from(text, (ch) => ch.charCodeAt(0));

describe("detectMimeFromBytes", () => {
	it("detects common single-marker formats", () => {
		expect(
			detectMimeFromBytes(
				bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
			),
		).toBe("image/png");
		expect(detectMimeFromBytes(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(
			"image/jpeg",
		);
		expect(detectMimeFromBytes(bytes(...ascii("GIF89a")))).toBe("image/gif");
		expect(detectMimeFromBytes(bytes(...ascii("%PDF-1.7")))).toBe(
			"application/pdf",
		);
		expect(detectMimeFromBytes(bytes(0x1a, 0x45, 0xdf, 0xa3))).toBe(
			"video/webm",
		);
		expect(detectMimeFromBytes(bytes(...ascii("ID3")))).toBe("audio/mpeg");
	});

	it("requires the full PNG signature (4-byte prefix is not enough)", () => {
		expect(detectMimeFromBytes(bytes(0x89, 0x50, 0x4e, 0x47))).toBeUndefined();
	});

	it("does not classify a raw MP3 frame sync (0xFFFB) as audio/mpeg", () => {
		expect(detectMimeFromBytes(bytes(0xff, 0xfb, 0x90, 0x00))).toBeUndefined();
	});

	it("detects offset-based RIFF containers and rejects unknown FourCC", () => {
		const riff = (fourcc: string) =>
			bytes(...ascii("RIFF"), 0, 0, 0, 0, ...ascii(fourcc));
		expect(detectMimeFromBytes(riff("WEBP"))).toBe("image/webp");
		expect(detectMimeFromBytes(riff("WAVE"))).toBe("audio/wav");
		expect(detectMimeFromBytes(riff("XXXX"))).toBeUndefined();
	});

	it("branches ISO base-media files by ftyp brand", () => {
		const ftyp = (brand: string) =>
			bytes(0, 0, 0, 0, ...ascii("ftyp"), ...ascii(brand), 0, 0, 0, 0);
		expect(detectMimeFromBytes(ftyp("avif"))).toBe("image/avif");
		expect(detectMimeFromBytes(ftyp("isom"))).toBe("video/mp4");
		expect(detectMimeFromBytes(ftyp("heic"))).toBe("image/heic");
		expect(detectMimeFromBytes(ftyp("qt  "))).toBe("video/quicktime");
		expect(detectMimeFromBytes(ftyp("zzzz"))).toBeUndefined();
	});

	it("returns undefined for unknown / too-short input", () => {
		expect(detectMimeFromBytes(bytes(0x00, 0x01, 0x02, 0x03))).toBeUndefined();
		expect(detectMimeFromBytes(bytes(0x89))).toBeUndefined(); // truncated PNG marker
		expect(detectMimeFromBytes(bytes())).toBeUndefined();
	});
});

describe("sniffFileMime", () => {
	it("reads a File's leading bytes and detects the type", async () => {
		const png = new File(
			[new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2])],
			"x",
		);
		expect(await sniffFileMime(png)).toBe("image/png");
	});

	it("only reads the leading bytes (content past the window is ignored)", async () => {
		// PNG signature followed by 10k of junk — still detected from the head.
		const png = new File(
			[
				new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
				"x".repeat(10_000),
			],
			"big.png",
		);
		expect(await sniffFileMime(png)).toBe("image/png");
	});

	it("returns undefined for content with no known signature", async () => {
		const txt = new File(["just some text"], "x.txt");
		expect(await sniffFileMime(txt)).toBeUndefined();
	});
});
