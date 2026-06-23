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

import type { AssetFolder } from "../types/folders.js";

/** Props for the delete-folder confirmation dialog. */
export interface DeleteFolderDialogProps {
	/** Folder to delete. `null` ⇒ closed. */
	readonly folder: AssetFolder | null;
	/** Confirm. `cascade=false` reparents children to the parent (default, safe);
	 *  `cascade=true` also deletes the descendant assets. */
	readonly onConfirm: (
		folder: AssetFolder,
		cascade: boolean,
	) => void | Promise<void>;
	readonly onCancel: () => void;
}

/** Confirmation dialog for deleting or cascading deletion of a folder. */
export function DeleteFolderDialog({
	folder,
	onConfirm,
	onCancel,
}: DeleteFolderDialogProps) {
	const msg = useMsg();
	const [busy, setBusy] = React.useState(false);

	async function confirm(cascade: boolean) {
		if (folder === null || busy) return;
		setBusy(true);
		try {
			await onConfirm(folder, cascade);
		} finally {
			setBusy(false);
		}
	}

	const open = folder !== null;
	const assetCount = folder?.counts.assets ?? 0;

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next && !busy) onCancel();
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{msg("assetManager.dialog.deleteFolderTitle")}
					</DialogTitle>
					<DialogDescription>
						{msg("assetManager.dialog.deleteFolderDescription")
							.replace("{name}", folder?.name ?? "")
							.replace("{count}", String(assetCount))
							.replace("{assets}", assetCount === 1 ? "asset" : "assets")}
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						disabled={busy}
						onClick={onCancel}
					>
						{msg("assetManager.button.cancel")}
					</Button>
					<Button
						type="button"
						variant="outline"
						disabled={busy || folder === null}
						onClick={() => void confirm(false)}
					>
						{busy
							? msg("assetManager.dialog.removeProgress")
							: msg("assetManager.dialog.removeFolder")}
					</Button>
					<Button
						type="button"
						variant="destructive"
						disabled={busy || folder === null}
						onClick={() => void confirm(true)}
					>
						{msg("assetManager.button.deleteContents")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
