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
import {
	MutationErrorAlert,
	mutationErrorMessage,
} from "./MutationErrorAlert.js";

/** Props for the delete-folder confirmation dialog. */
export interface DeleteFolderDialogProps {
	/** Folder to delete. `null` ⇒ closed. */
	readonly folder: AssetFolder | null;
	/**
	 * Total number of assets that a cascading delete will remove from the folder
	 * and its entire descendant tree. This is an explicit deletion preflight;
	 * {@link AssetFolder.counts}.assets is direct-only and must not be used here.
	 */
	readonly cascadeAssetCount: number;
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
	cascadeAssetCount,
	onConfirm,
	onCancel,
}: DeleteFolderDialogProps) {
	const msg = useMsg();
	const [busy, setBusy] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);

	async function confirm(cascade: boolean) {
		if (folder === null || busy) return;
		setBusy(true);
		setError(null);
		try {
			await onConfirm(folder, cascade);
		} catch (cause) {
			setError(
				mutationErrorMessage(cause, msg("assetManager.error.mutationRetry")),
			);
		} finally {
			setBusy(false);
		}
	}

	const open = folder !== null;
	function cancel() {
		setError(null);
		onCancel();
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next && !busy) cancel();
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
							.replace("{count}", String(cascadeAssetCount))
							.replace(
								"{assets}",
								cascadeAssetCount === 1 ? "asset" : "assets",
							)}
					</DialogDescription>
				</DialogHeader>
				<MutationErrorAlert message={error} />
				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						disabled={busy}
						onClick={cancel}
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
