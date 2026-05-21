/** @vitest-environment happy-dom */

import { afterEach, describe, expect, it, vi } from "vitest";

import { extractImageDimensions } from "./extract-image-dimensions.js";

interface FakeImageInstance {
	onload: (() => void) | null;
	onerror: (() => void) | null;
	src: string;
	naturalWidth: number;
	naturalHeight: number;
}

function stubImage(configure: (instance: FakeImageInstance) => void): {
	restore: () => void;
} {
	const original = globalThis.Image;
	const FakeImage = class {
		onload: (() => void) | null = null;
		onerror: (() => void) | null = null;
		naturalWidth = 0;
		naturalHeight = 0;
		set src(value: string) {
			this._src = value;
			queueMicrotask(() => configure(this));
		}
		get src() {
			return this._src;
		}
		_src = "";
	} as unknown as typeof globalThis.Image;
	(globalThis as { Image: typeof globalThis.Image }).Image = FakeImage;
	return {
		restore() {
			(globalThis as { Image: typeof globalThis.Image }).Image = original;
		},
	};
}

afterEach(() => {
	vi.useRealTimers();
});

describe("extractImageDimensions", () => {
	it("returns undefined for non-image MIME types", async () => {
		const dims = await extractImageDimensions(
			"data:text/plain;base64,aGVsbG8=",
			"text/plain",
		);
		expect(dims).toBeUndefined();
	});

	it("returns undefined when MIME type is missing", async () => {
		const dims = await extractImageDimensions("https://example/img", undefined);
		expect(dims).toBeUndefined();
	});

	it("returns undefined when Image global is unavailable", async () => {
		const original = globalThis.Image;
		(globalThis as { Image?: typeof globalThis.Image }).Image = undefined;
		try {
			const dims = await extractImageDimensions(
				"https://example/img.png",
				"image/png",
			);
			expect(dims).toBeUndefined();
		} finally {
			(globalThis as { Image: typeof globalThis.Image }).Image = original;
		}
	});

	it("resolves width and height on successful decode", async () => {
		const stub = stubImage((instance) => {
			instance.naturalWidth = 320;
			instance.naturalHeight = 240;
			instance.onload?.();
		});
		try {
			const dims = await extractImageDimensions(
				"data:image/png;base64,abcd",
				"image/png",
			);
			expect(dims).toEqual({ width: 320, height: 240 });
		} finally {
			stub.restore();
		}
	});

	it("returns undefined when decode fires onerror", async () => {
		const stub = stubImage((instance) => {
			instance.onerror?.();
		});
		try {
			const dims = await extractImageDimensions(
				"data:image/png;base64,broken",
				"image/png",
			);
			expect(dims).toBeUndefined();
		} finally {
			stub.restore();
		}
	});

	it("returns undefined when decoded dimensions are zero", async () => {
		const stub = stubImage((instance) => {
			instance.naturalWidth = 0;
			instance.naturalHeight = 0;
			instance.onload?.();
		});
		try {
			const dims = await extractImageDimensions(
				"data:image/png;base64,blank",
				"image/png",
			);
			expect(dims).toBeUndefined();
		} finally {
			stub.restore();
		}
	});

	it("times out when decode never settles", async () => {
		vi.useFakeTimers();
		const stub = stubImage(() => {
			// never fires onload/onerror
		});
		try {
			const promise = extractImageDimensions(
				"data:image/png;base64,stuck",
				"image/png",
				{ timeoutMs: 50 },
			);
			await vi.advanceTimersByTimeAsync(60);
			const dims = await promise;
			expect(dims).toBeUndefined();
		} finally {
			stub.restore();
		}
	});
});
