import type { StudioAsset, StudioAssetUploadEvent } from "@anvilkit/core/types";
import { describe, expect, it } from "vitest";

import { createAssetRegistry } from "../utils/registry.js";
import { createStudioAssetSource } from "../utils/studio-asset-source.js";
import type { UploadResult } from "../types/types.js";

const PNG: UploadResult = {
  id: "png-1",
  url: "https://cdn.example.com/photo.png",
  name: "photo.png",
  meta: { mimeType: "image/png", size: 1024 },
};

const MP4: UploadResult = {
  id: "mp4-1",
  url: "https://cdn.example.com/clip.mp4",
  name: "clip.mp4",
  meta: { mimeType: "video/mp4", size: 4096 },
};

const MP3: UploadResult = {
  id: "mp3-1",
  url: "https://cdn.example.com/track.mp3",
  name: "track.mp3",
  meta: { mimeType: "audio/mpeg", size: 2048 },
};

describe("createStudioAssetSource", () => {
  it("maps registry entries to StudioAsset shape with the inferred kind", () => {
    const registry = createAssetRegistry();
    registry.register(PNG);
    registry.register(MP4);
    registry.register(MP3);
    const source = createStudioAssetSource({
      registry,
      upload: async () => PNG,
    });

    const list = source.list();

    expect(list).toEqual<readonly StudioAsset[]>([
      {
        id: "png-1",
        kind: "image",
        name: "photo.png",
        url: "asset://png-1",
        thumbnailUrl: "https://cdn.example.com/photo.png",
        mimeType: "image/png",
        size: 1024,
      },
      {
        id: "mp4-1",
        kind: "video",
        name: "clip.mp4",
        url: "asset://mp4-1",
        mimeType: "video/mp4",
        size: 4096,
      },
      {
        id: "mp3-1",
        kind: "audio",
        name: "track.mp3",
        url: "asset://mp3-1",
        mimeType: "audio/mpeg",
        size: 2048,
      },
    ]);
  });

  it("derives a fallback name when the registry entry has none", () => {
    const registry = createAssetRegistry();
    registry.register({
      id: "no-name",
      url: "https://cdn.example.com/banner.jpg",
      meta: { mimeType: "image/jpeg" },
    });
    const source = createStudioAssetSource({
      registry,
      upload: async () => PNG,
    });

    const [asset] = source.list();

    expect(asset?.name).toBe("banner.jpg");
  });

  it("emits a progress envelope and a done envelope per uploaded file", async () => {
    const registry = createAssetRegistry();
    const source = createStudioAssetSource({
      registry,
      upload: async (file) => ({
        id: `id-${file.name}`,
        url: `https://cdn.example.com/${file.name}`,
        name: file.name,
        meta: { mimeType: file.type, size: file.size },
      }),
    });
    const events: StudioAssetUploadEvent[] = [];
    const file = new File(["hello"], "cover.png", { type: "image/png" });

    const uploaded = await source.upload([file], (event) => {
      events.push(event);
    });

    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]?.id).toBe("id-cover.png");
    expect(uploaded[0]?.name).toBe("cover.png");
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      type: "progress",
      bytesUploaded: file.size,
      bytesTotal: file.size,
    });
    expect(events[1]).toMatchObject({ type: "done" });
    if (events[1]?.type === "done") {
      expect(events[1].asset.id).toBe("id-cover.png");
    }
  });

  it("emits an error envelope and returns the successful subset on per-file failure", async () => {
    const registry = createAssetRegistry();
    const source = createStudioAssetSource({
      registry,
      upload: async () => {
        throw new Error("upload boom");
      },
    });
    const events: StudioAssetUploadEvent[] = [];
    const file = new File(["x"], "broken.png", { type: "image/png" });

    // PRD §3.3.3: per-file failures surface via the listener, not as a
    // thrown error. The batch resolves with the successful subset.
    const result = await source.upload([file], (event) => events.push(event));
    expect(result).toEqual([]);
    expect(events).toEqual([{ type: "error", message: "upload boom" }]);
  });

  it("notifies subscribers on register, delete, rename, and replace", () => {
    const registry = createAssetRegistry();
    const source = createStudioAssetSource({
      registry,
      upload: async () => PNG,
    });
    let notified = 0;
    const unsubscribe = source.subscribe?.(() => {
      notified += 1;
    });

    registry.register(PNG);
    expect(notified).toBe(1);

    void source.rename?.("png-1", "renamed.png");
    expect(notified).toBe(2);

    void source
      .replace?.("png-1", new File([""], "ignored.png", { type: "image/png" }))
      .catch(() => {
        // `replace` calls upload(); the test's `upload` returns PNG so
        // replace round-trips without error.
      });

    void source.delete?.("png-1");
    expect(notified).toBeGreaterThanOrEqual(3);

    unsubscribe?.();
    registry.register(PNG);
    expect(notified).toBeGreaterThanOrEqual(3);
  });

  it("rename updates the registry entry's display name", () => {
    const registry = createAssetRegistry();
    registry.register(PNG);
    const source = createStudioAssetSource({
      registry,
      upload: async () => PNG,
    });

    void source.rename?.("png-1", "hero-cover.png");

    expect(registry.get("png-1")?.name).toBe("hero-cover.png");
    expect(source.list()[0]?.name).toBe("hero-cover.png");
  });

  it("replace runs the upload pipeline and swaps the registry entry", async () => {
    const registry = createAssetRegistry();
    registry.register(PNG);
    const source = createStudioAssetSource({
      registry,
      upload: async (file) => ({
        id: "ignored-incoming-id",
        url: `https://cdn.example.com/${file.name}`,
        name: file.name,
        meta: { mimeType: file.type, size: file.size },
      }),
    });
    const replacement = new File(["bytes"], "next.png", { type: "image/png" });

    const result = await source.replace?.("png-1", replacement);

    expect(result?.id).toBe("png-1");
    expect(result?.name).toBe("next.png");
    expect(registry.get("png-1")?.name).toBe("next.png");
  });

  it("delete removes the asset from the registry", () => {
    const registry = createAssetRegistry();
    registry.register(PNG);
    const source = createStudioAssetSource({
      registry,
      upload: async () => PNG,
    });

    void source.delete?.("png-1");

    expect(registry.get("png-1")).toBeUndefined();
    expect(source.list()).toHaveLength(0);
  });

  it("getUrl returns the canonical asset:// reference", () => {
    const registry = createAssetRegistry();
    const source = createStudioAssetSource({
      registry,
      upload: async () => PNG,
    });

    expect(source.getUrl?.("any-id")).toBe("asset://any-id");
  });

  it("infers font kind for font/* MIME and font URL extensions", () => {
    const registry = createAssetRegistry();
    registry.register({
      id: "font-mime",
      url: "https://cdn.example.com/sans.bin",
      meta: { mimeType: "font/woff2", size: 1024 },
    });
    registry.register({
      id: "font-ext",
      url: "https://cdn.example.com/sans.woff2?v=2",
      meta: { mimeType: "application/octet-stream", size: 1024 },
    });
    const source = createStudioAssetSource({
      registry,
      upload: async () => PNG,
    });

    const list = source.list();

    expect(list[0]?.kind).toBe("font");
    expect(list[1]?.kind).toBe("font");
  });

  it("infers document kind for application/pdf and .pdf URLs", () => {
    const registry = createAssetRegistry();
    registry.register({
      id: "pdf-mime",
      url: "https://cdn.example.com/spec.bin",
      meta: { mimeType: "application/pdf", size: 1024 },
    });
    registry.register({
      id: "pdf-ext",
      url: "https://cdn.example.com/spec.pdf#page=2",
      meta: { mimeType: "application/octet-stream", size: 1024 },
    });
    const source = createStudioAssetSource({
      registry,
      upload: async () => PNG,
    });

    const list = source.list();

    expect(list[0]?.kind).toBe("document");
    expect(list[1]?.kind).toBe("document");
  });

  it("defaults thumbnailUrl to the underlying URL for image assets only", () => {
    const registry = createAssetRegistry();
    registry.register(PNG);
    registry.register(MP4);
    const source = createStudioAssetSource({
      registry,
      upload: async () => PNG,
    });

    const list = source.list();
    const image = list.find((asset) => asset.id === "png-1");
    const video = list.find((asset) => asset.id === "mp4-1");

    expect(image?.thumbnailUrl).toBe("https://cdn.example.com/photo.png");
    expect(video?.thumbnailUrl).toBeUndefined();
  });

  it("getThumbnail option overrides the default for any kind", () => {
    const registry = createAssetRegistry();
    registry.register(PNG);
    registry.register(MP4);
    const source = createStudioAssetSource({
      registry,
      upload: async () => PNG,
      getThumbnail: (entry) =>
        entry.id === "mp4-1" ? `${entry.url}?frame=1` : undefined,
    });

    const list = source.list();
    const image = list.find((asset) => asset.id === "png-1");
    const video = list.find((asset) => asset.id === "mp4-1");

    expect(image?.thumbnailUrl).toBeUndefined();
    expect(video?.thumbnailUrl).toBe(
      "https://cdn.example.com/clip.mp4?frame=1",
    );
  });
});
