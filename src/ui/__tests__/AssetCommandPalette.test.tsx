/** @vitest-environment happy-dom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAssetRegistry } from "../../utils/registry.js";
import type { UploadResult } from "../../types.js";
import { AssetCommandPalette } from "../AssetCommandPalette.js";

afterEach(() => {
  cleanup();
});

const PNG: UploadResult = {
  id: "img-hero",
  url: "https://cdn.example.com/hero.png",
  name: "hero-banner.png",
  meta: { mimeType: "image/png" },
  tags: ["image", "hero"],
};

const MP4: UploadResult = {
  id: "vid-promo",
  url: "https://cdn.example.com/promo.mp4",
  name: "promo.mp4",
  meta: { mimeType: "video/mp4" },
  tags: ["video"],
};

function seed() {
  const registry = createAssetRegistry();
  registry.register(PNG);
  registry.register(MP4);
  return registry;
}

describe("AssetCommandPalette", () => {
  it("renders all assets when open with empty query", () => {
    const registry = seed();
    render(
      <AssetCommandPalette
        onOpenChange={() => undefined}
        onSelect={() => undefined}
        open
        registry={registry}
      />,
    );

    const buttons = screen.getAllByRole("button", { name: /Insert asset/i });
    expect(buttons).toHaveLength(2);
  });

  it("filters as the user types", () => {
    const registry = seed();
    render(
      <AssetCommandPalette
        onOpenChange={() => undefined}
        onSelect={() => undefined}
        open
        registry={registry}
      />,
    );

    const input = screen.getByLabelText(
      "Asset search query",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "promo" } });

    const buttons = screen.getAllByRole("button", { name: /Insert asset/i });
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.getAttribute("aria-label")).toBe(
      "Insert asset vid-promo",
    );
  });

  it("Enter on the search input picks the active result and closes", () => {
    const registry = seed();
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <AssetCommandPalette
        onOpenChange={onOpenChange}
        onSelect={onSelect}
        open
        registry={registry}
      />,
    );

    const input = screen.getByLabelText("Asset search query");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("shows a no-matches placeholder when results are empty", () => {
    const registry = seed();
    render(
      <AssetCommandPalette
        onOpenChange={() => undefined}
        onSelect={() => undefined}
        open
        registry={registry}
      />,
    );

    const input = screen.getByLabelText("Asset search query");
    fireEvent.change(input, { target: { value: "xxxxxxxx" } });

    expect(screen.getByText("No matches.")).toBeTruthy();
  });
});
