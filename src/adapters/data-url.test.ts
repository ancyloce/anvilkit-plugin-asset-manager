/** @vitest-environment happy-dom */

import { describe, expect, it } from "vitest";

import { AssetValidationError } from "../utils/errors.js";
import { dataUrlUploader } from "./data-url.js";

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

  it("populates width and height for image MIME types", async () => {
    const stub = stubImage(640, 480);
    try {
      const uploader = dataUrlUploader();
      const result = await uploader(
        new File([new Uint8Array([1, 2, 3])], "pic.png", {
          type: "image/png",
        }),
      );

      expect(result.meta?.width).toBe(640);
      expect(result.meta?.height).toBe(480);
      expect(result.meta?.mimeType).toBe("image/png");
    } finally {
      stub.restore();
    }
  });

  it("omits width and height for non-image MIME types", async () => {
    const uploader = dataUrlUploader();
    const result = await uploader(
      new File(["hello"], "hello.txt", { type: "text/plain" }),
    );

    expect(result.meta?.width).toBeUndefined();
    expect(result.meta?.height).toBeUndefined();
  });
});
