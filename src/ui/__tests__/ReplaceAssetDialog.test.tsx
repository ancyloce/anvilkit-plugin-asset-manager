/** @vitest-environment happy-dom */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { UploadResult } from "../../types.js";
import { ReplaceAssetDialog } from "../ReplaceAssetDialog.js";

function noop(): void {
  // Placeholder for tests that need a callback prop they ignore.
}

afterEach(() => {
  cleanup();
});

const sampleAsset: UploadResult = Object.freeze({
  id: "asset-1",
  url: "https://cdn.example.com/a.png",
  name: "a.png",
});

function pickFile(file: File) {
  const input = screen.getByTestId(
    "replace-asset-file-input",
  ) as HTMLInputElement;
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [file],
  });
  fireEvent.change(input);
}

describe("ReplaceAssetDialog", () => {
  it("renders the picker disabled until a file is selected", async () => {
    render(
      <ReplaceAssetDialog
        asset={sampleAsset}
        onCancel={noop}
        onConfirm={noop}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("Replace asset?")).toBeDefined();
    });
    const replace = screen.getByRole("button", {
      name: "Replace",
    }) as HTMLButtonElement;
    expect(replace.disabled).toBe(true);
    expect(screen.getByText("No file selected.")).toBeDefined();
  });

  it("enables Replace once a valid file is chosen", async () => {
    render(
      <ReplaceAssetDialog
        asset={sampleAsset}
        onCancel={noop}
        onConfirm={noop}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("Replace asset?")).toBeDefined();
    });
    const file = new File(["hi"], "next.png", { type: "image/png" });
    pickFile(file);
    await waitFor(() => {
      expect(screen.getByText(/Selected: next\.png/)).toBeDefined();
    });
    const replace = screen.getByRole("button", {
      name: "Replace",
    }) as HTMLButtonElement;
    expect(replace.disabled).toBe(false);
  });

  it("rejects oversized files with an error message", async () => {
    render(
      <ReplaceAssetDialog
        asset={sampleAsset}
        maxFileSize={4}
        onCancel={noop}
        onConfirm={noop}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("Replace asset?")).toBeDefined();
    });
    const file = new File(["too-big"], "big.png", { type: "image/png" });
    pickFile(file);
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent ?? "").toMatch(
        /exceeds the configured maxFileSize/,
      );
    });
    const replace = screen.getByRole("button", {
      name: "Replace",
    }) as HTMLButtonElement;
    expect(replace.disabled).toBe(true);
  });

  it("rejects disallowed mime types", async () => {
    render(
      <ReplaceAssetDialog
        acceptedMimeTypes={["image/*"]}
        asset={sampleAsset}
        onCancel={noop}
        onConfirm={noop}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("Replace asset?")).toBeDefined();
    });
    const file = new File(["x"], "doc.txt", { type: "text/plain" });
    pickFile(file);
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent ?? "").toMatch(
        /text\/plain/,
      );
    });
  });

  it("calls onConfirm with asset + file when Replace is clicked", async () => {
    const onConfirm = vi.fn();
    render(
      <ReplaceAssetDialog
        asset={sampleAsset}
        onCancel={noop}
        onConfirm={onConfirm}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("Replace asset?")).toBeDefined();
    });
    const file = new File(["x"], "next.png", { type: "image/png" });
    pickFile(file);
    await waitFor(() => {
      expect(screen.getByText(/Selected: next\.png/)).toBeDefined();
    });
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith(sampleAsset, file);
    });
  });

  it("calls onCancel when Cancel is clicked", async () => {
    const onCancel = vi.fn();
    render(
      <ReplaceAssetDialog
        asset={sampleAsset}
        onCancel={onCancel}
        onConfirm={noop}
      />,
    );
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Cancel" })).toBeDefined();
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("does not render when asset is null", () => {
    render(
      <ReplaceAssetDialog asset={null} onCancel={noop} onConfirm={noop} />,
    );
    expect(screen.queryByText("Replace asset?")).toBeNull();
  });
});
