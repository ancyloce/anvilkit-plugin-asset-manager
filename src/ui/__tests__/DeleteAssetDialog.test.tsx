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
import { DeleteAssetDialog } from "../DeleteAssetDialog.js";

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
	meta: Object.freeze({ size: 100, mimeType: "image/png" }),
});

describe("DeleteAssetDialog", () => {
	it("does not render when asset is null", () => {
		render(<DeleteAssetDialog asset={null} onCancel={noop} onConfirm={noop} />);
		expect(screen.queryByText("Delete asset?")).toBeNull();
	});

	it("renders the title, description with mime, and action buttons", async () => {
		render(
			<DeleteAssetDialog
				asset={sampleAsset}
				onCancel={noop}
				onConfirm={noop}
			/>,
		);
		await waitFor(() => {
			expect(screen.getByText("Delete asset?")).toBeDefined();
		});
		expect(screen.getByText(/a\.png/)).toBeDefined();
		expect(screen.getByText(/image\/png/)).toBeDefined();
		expect(screen.getByRole("button", { name: "Delete" })).toBeDefined();
		expect(screen.getByRole("button", { name: "Cancel" })).toBeDefined();
	});

	it("calls onConfirm with the asset when Delete is clicked", async () => {
		const onConfirm = vi.fn();
		render(
			<DeleteAssetDialog
				asset={sampleAsset}
				onCancel={noop}
				onConfirm={onConfirm}
			/>,
		);
		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Delete" })).toBeDefined();
		});
		fireEvent.click(screen.getByRole("button", { name: "Delete" }));
		await waitFor(() => {
			expect(onConfirm).toHaveBeenCalledWith(sampleAsset);
		});
	});

	it("calls onCancel when Cancel is clicked", async () => {
		const onCancel = vi.fn();
		render(
			<DeleteAssetDialog
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

	it("includes reference count when provided", async () => {
		render(
			<DeleteAssetDialog
				asset={sampleAsset}
				onCancel={noop}
				onConfirm={noop}
				referenceCount={3}
			/>,
		);
		await waitFor(() => {
			expect(screen.getByText(/referenced in 3 nodes/)).toBeDefined();
		});
	});

	it("disables buttons while a confirm callback is in flight", async () => {
		let resolveConfirm: (() => void) | null = null;
		const onConfirm = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					resolveConfirm = resolve;
				}),
		);
		render(
			<DeleteAssetDialog
				asset={sampleAsset}
				onCancel={noop}
				onConfirm={onConfirm}
			/>,
		);
		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Delete" })).toBeDefined();
		});
		fireEvent.click(screen.getByRole("button", { name: "Delete" }));
		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Deleting…" })).toBeDefined();
		});
		expect(
			(screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
		resolveConfirm?.();
	});
});
