"use client";

import { useMsg } from "@anvilkit/core/i18n";
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

import type { UploadResult } from "../types/types.js";

/** Props for the delete-asset confirmation dialog. */
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

/** Confirmation dialog for deleting a single asset. */
export function DeleteAssetDialog({
	asset,
	onCancel,
	onConfirm,
	referenceCount,
}: DeleteAssetDialogProps) {
	const msg = useMsg();
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
					<DialogTitle>{msg("assetManager.dialog.deleteTitle")}</DialogTitle>
					<DialogDescription>
						{label}
						{mimeType ? ` (${mimeType})` : ""}{" "}
						{msg("assetManager.dialog.deleteDescription")}
						{typeof referenceCount === "number" && referenceCount > 0
							? ` ${msg("assetManager.dialog.deleteReferenced")
									.replace("{count}", String(referenceCount))
									.replace("{nodes}", referenceCount === 1 ? "node" : "nodes")}`
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
						{msg("assetManager.button.cancel")}
					</Button>
					<Button
						type="button"
						variant="destructive"
						onClick={handleConfirm}
						disabled={busy || asset === null}
					>
						{busy
							? msg("assetManager.dialog.deleteProgress")
							: msg("assetManager.button.delete")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
