/** @vitest-environment happy-dom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { UploadButton } from "../UploadButton.js";
import { cleanup, fireEvent, render, screen, waitFor } from "./test-utils.js";

afterEach(() => {
	cleanup();
});

const noop = () => undefined;

function buildDataTransfer(files: readonly File[]): DataTransfer {
	return {
		files: files as unknown as FileList,
		types: ["Files"],
		items: [] as unknown as DataTransferItemList,
		dropEffect: "none",
		effectAllowed: "all",
		clearData: noop,
		getData: () => "",
		setData: noop,
		setDragImage: noop,
	} as unknown as DataTransfer;
}

describe("UploadButton drag-and-drop", () => {
	it("uploads files dropped on the drop zone", async () => {
		const uploader = vi.fn(async (file: File) => ({
			id: `id-${file.name}`,
			url: `https://cdn.example.com/${file.name}`,
		}));
		const onUploaded = vi.fn();
		const { container } = render(
			<UploadButton onUploaded={onUploaded} uploader={uploader} />,
		);

		const dropZone = container.querySelector("[data-asset-manager-drop-zone]");
		if (!(dropZone instanceof HTMLElement)) {
			throw new Error("drop zone not found");
		}

		const fileA = new File(["a"], "a.png", { type: "image/png" });
		const fileB = new File(["b"], "b.png", { type: "image/png" });

		fireEvent.drop(dropZone, {
			dataTransfer: buildDataTransfer([fileA, fileB]),
		});

		await waitFor(() => {
			expect(uploader).toHaveBeenCalledTimes(2);
		});
		expect(onUploaded).toHaveBeenCalledTimes(2);
	});

	it("emits onError per rejected file when MIME is not in the allowlist", async () => {
		const uploader = vi.fn(async (file: File) => ({
			id: `id-${file.name}`,
			url: `https://cdn.example.com/${file.name}`,
		}));
		const onError = vi.fn();
		const onUploaded = vi.fn();
		const { container } = render(
			<UploadButton
				acceptedMimeTypes={["image/png"]}
				onError={onError}
				onUploaded={onUploaded}
				uploader={uploader}
			/>,
		);

		const dropZone = container.querySelector("[data-asset-manager-drop-zone]");
		if (!(dropZone instanceof HTMLElement)) {
			throw new Error("drop zone not found");
		}

		const rejected = new File(["x"], "doc.pdf", { type: "application/pdf" });
		fireEvent.drop(dropZone, {
			dataTransfer: buildDataTransfer([rejected]),
		});

		await waitFor(() => {
			expect(onError).toHaveBeenCalledTimes(1);
		});
		expect(uploader).not.toHaveBeenCalled();
		expect(onUploaded).not.toHaveBeenCalled();
	});

	it("keeps the drop zone out of the tab order while button stays focusable", () => {
		const { container } = render(
			<UploadButton uploader={async () => ({ id: "x", url: "https://x" })} />,
		);

		const dropZone = container.querySelector("[data-asset-manager-drop-zone]");
		expect(dropZone?.getAttribute("tabindex")).toBe("-1");

		const button = screen.getByRole("button", { name: "Upload asset file" });
		expect(button.getAttribute("tabindex")).not.toBe("-1");
	});

	it("emits onProgress snapshots per file and a terminal null", async () => {
		const uploader = vi.fn(async (file: File) => ({
			id: `id-${file.name}`,
			url: `https://cdn.example.com/${file.name}`,
		}));
		const snapshots: Array<{ completed: number; total: number } | null> = [];
		const { container } = render(
			<UploadButton
				onProgress={(snapshot) => {
					snapshots.push(snapshot);
				}}
				uploader={uploader}
			/>,
		);

		const dropZone = container.querySelector("[data-asset-manager-drop-zone]");
		if (!(dropZone instanceof HTMLElement)) {
			throw new Error("drop zone not found");
		}
		const fileA = new File(["a"], "a.png", { type: "image/png" });
		const fileB = new File(["b"], "b.png", { type: "image/png" });

		fireEvent.drop(dropZone, {
			dataTransfer: buildDataTransfer([fileA, fileB]),
		});

		await waitFor(() => {
			expect(snapshots[snapshots.length - 1]).toBeNull();
		});
		expect(snapshots[0]).toEqual({ completed: 0, total: 2 });
		expect(
			snapshots.some(
				(snap) => snap !== null && snap.completed === 1 && snap.total === 2,
			),
		).toBe(true);
		expect(
			snapshots.some(
				(snap) => snap !== null && snap.completed === 2 && snap.total === 2,
			),
		).toBe(true);
	});
});
