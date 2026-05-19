"use client";

import { Button } from "@anvilkit/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@anvilkit/ui/dialog";
import * as React from "react";

import type { UploadResult } from "../types.js";

export interface DeleteAssetDialogProps {
	/**
	 * Asset to confirm deletion for. When `null`, the dialog is closed.
	 * Setting this to an asset opens the dialog; the host clears it on
	 * cancel or after confirm resolves.
	 */
	readonly asset: UploadResult | null;
	/**
	 * Called when the user confirms. May return a Promise to keep the
	 * "Delete" button in a busy state until it settles.
	 */
	readonly onConfirm: (asset: UploadResult) => void | Promise<void>;
	readonly onCancel: () => void;
	/**
	 * Optional context such as "This asset is referenced in 2 nodes".
	 * Rendered after the default destructive-action description.
	 */
	readonly referenceCount?: number;
}

export function DeleteAssetDialog({
	asset,
	onCancel,
	onConfirm,
	referenceCount,
}: DeleteAssetDialogProps) {
	const [busy, setBusy] = React.useState(false);

	async function handleConfirm() {
		if (asset === null || busy) {
			return;
		}
		setBusy(true);
		try {
			await onConfirm(asset);
		} finally {
			setBusy(false);
		}
	}

	function handleOpenChange(nextOpen: boolean) {
		if (!nextOpen && !busy) {
			onCancel();
		}
	}

	const open = asset !== null;
	const label = asset?.name ?? asset?.id ?? "";
	const mimeType = asset?.meta?.mimeType;

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Delete asset?</DialogTitle>
					<DialogDescription>
						{label}
						{mimeType ? ` (${mimeType})` : ""} will be removed from the
						registry. References to it in the page will fail to resolve.
						{typeof referenceCount === "number" && referenceCount > 0
							? ` This asset is referenced in ${referenceCount} ${
									referenceCount === 1 ? "node" : "nodes"
								}.`
							: ""}
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						onClick={onCancel}
						disabled={busy}
					>
						Cancel
					</Button>
					<Button
						type="button"
						variant="destructive"
						onClick={handleConfirm}
						disabled={busy || asset === null}
					>
						{busy ? "Deleting…" : "Delete"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
