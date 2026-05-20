/** @vitest-environment happy-dom */

import { describe, expect, it } from "vitest";

import { inMemoryUploader } from "./in-memory.js";

interface FakeImageInstance {
  onload: (() => void) | null;
  onerror: (() => void) | null;
  naturalWidth: number;
  naturalHeight: number;
}

function stubImage(width: number, height: number): { restore: () => void } {
  const original = globalThis.Image;
  const FakeImage = class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 0;
    naturalHeight = 0;
    set src(value: string) {
      this._src = value;
      queueMicrotask(() => {
        (this as unknown as FakeImageInstance).naturalWidth = width;
        (this as unknown as FakeImageInstance).naturalHeight = height;
        this.onload?.();
      });
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

  it("populates width and height for image MIME types", async () => {
    const stub = stubImage(1024, 768);
    try {
      const uploader = inMemoryUploader();
      const result = await uploader(
        new File([new Uint8Array([1, 2, 3])], "pic.jpg", {
          type: "image/jpeg",
        }),
      );
      expect(result.meta?.width).toBe(1024);
      expect(result.meta?.height).toBe(768);
    } finally {
      stub.restore();
    }
  });
});
