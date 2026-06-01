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

import type { AssetFolder } from "../types/folders.js";

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

export function DeleteFolderDialog({
	folder,
	onConfirm,
	onCancel,
}: DeleteFolderDialogProps) {
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
					<DialogTitle>Delete folder?</DialogTitle>
					<DialogDescription>
						“{folder?.name}” will be removed. By default its contents move up to
						the parent folder — nothing is deleted. Choose “Delete contents” to
						remove its {assetCount} {assetCount === 1 ? "asset" : "assets"} too.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						disabled={busy}
						onClick={onCancel}
					>
						Cancel
					</Button>
					<Button
						type="button"
						variant="outline"
						disabled={busy || folder === null}
						onClick={() => void confirm(false)}
					>
						{busy ? "Removing…" : "Remove folder"}
					</Button>
					<Button
						type="button"
						variant="destructive"
						disabled={busy || folder === null}
						onClick={() => void confirm(true)}
					>
						Delete contents
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
