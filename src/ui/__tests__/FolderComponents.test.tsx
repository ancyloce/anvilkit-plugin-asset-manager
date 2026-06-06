/** @vitest-environment happy-dom */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetFolder } from "../../types/folders.js";
import { DeleteFolderDialog } from "../DeleteFolderDialog.js";
import { EmptyFolderState } from "../EmptyFolderState.js";
import { FolderBreadcrumb } from "../FolderBreadcrumb.js";
import { FolderNameDialog } from "../FolderNameDialog.js";
import { ASSET_DRAG_MIME, FolderTree } from "../FolderTree.js";
import { MoveTargetPicker } from "../MoveTargetPicker.js";
import { cleanup, fireEvent, render, screen, waitFor } from "./test-utils.js";

afterEach(() => {
	cleanup();
});

function folder(
	id: string,
	name: string,
	parentId: string | null,
): AssetFolder {
	return {
		id,
		name,
		parentId,
		createdAt: 0,
		updatedAt: 0,
		counts: { assets: 2, folders: 0 },
	};
}

describe("FolderBreadcrumb", () => {
	it("navigates to root and to a crumb; marks the current folder", () => {
		const onNavigate = vi.fn();
		render(
			<FolderBreadcrumb
				path={[folder("a", "Marketing", null), folder("b", "Q3", "a")]}
				onNavigate={onNavigate}
			/>,
		);
		fireEvent.click(screen.getByText("All assets"));
		expect(onNavigate).toHaveBeenCalledWith(null);
		fireEvent.click(screen.getByText("Marketing"));
		expect(onNavigate).toHaveBeenCalledWith("a");
		expect(screen.getByText("Q3").getAttribute("aria-current")).toBe("page");
	});
});

describe("FolderTree", () => {
	it("navigates on click and accepts an asset drop", () => {
		const onNavigate = vi.fn();
		const onDropAssets = vi.fn();
		render(
			<FolderTree
				folders={[folder("a", "Marketing", null)]}
				currentFolderId={null}
				onNavigate={onNavigate}
				onDropAssets={onDropAssets}
			/>,
		);
		const row = screen.getByText(/Marketing/);
		fireEvent.click(row);
		expect(onNavigate).toHaveBeenCalledWith("a");
		fireEvent.drop(row, {
			dataTransfer: {
				getData: (type: string) =>
					type === ASSET_DRAG_MIME ? JSON.stringify(["x1", "x2"]) : "",
			},
		});
		expect(onDropAssets).toHaveBeenCalledWith(["x1", "x2"], "a");
	});
});

describe("FolderNameDialog", () => {
	it("submits a trimmed name and closes", async () => {
		const onSubmit = vi.fn().mockResolvedValue(undefined);
		const onOpenChange = vi.fn();
		render(
			<FolderNameDialog open onOpenChange={onOpenChange} onSubmit={onSubmit} />,
		);
		fireEvent.change(screen.getByTestId("ak-folder-name-input"), {
			target: { value: "  Brand  " },
		});
		fireEvent.click(screen.getByText("Create"));
		await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("Brand"));
		await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
	});
});

describe("DeleteFolderDialog", () => {
	it("offers reparent (default) and cascade delete", async () => {
		const onConfirm = vi.fn().mockResolvedValue(undefined);
		render(
			<DeleteFolderDialog
				folder={folder("a", "Marketing", null)}
				onConfirm={onConfirm}
				onCancel={vi.fn()}
			/>,
		);
		fireEvent.click(screen.getByText("Remove folder"));
		await waitFor(() =>
			expect(onConfirm).toHaveBeenCalledWith(expect.anything(), false),
		);
		cleanup();
		render(
			<DeleteFolderDialog
				folder={folder("a", "Marketing", null)}
				onConfirm={onConfirm}
				onCancel={vi.fn()}
			/>,
		);
		fireEvent.click(screen.getByText("Delete contents"));
		await waitFor(() =>
			expect(onConfirm).toHaveBeenCalledWith(expect.anything(), true),
		);
	});
});

describe("MoveTargetPicker", () => {
	it("picks root or a folder target", async () => {
		const onPick = vi.fn().mockResolvedValue(undefined);
		render(
			<MoveTargetPicker
				open
				onOpenChange={vi.fn()}
				folders={[folder("a", "Marketing", null)]}
				onPick={onPick}
			/>,
		);
		fireEvent.click(screen.getByText("Marketing"));
		await waitFor(() => expect(onPick).toHaveBeenCalledWith("a"));
	});
});

describe("EmptyFolderState", () => {
	it("invokes onUpload from the CTA", () => {
		const onUpload = vi.fn();
		render(<EmptyFolderState onUpload={onUpload} />);
		fireEvent.click(screen.getByText("Drop files here or upload"));
		expect(onUpload).toHaveBeenCalled();
	});
});
