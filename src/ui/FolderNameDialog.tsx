"use client";

import { useMsg } from "@anvilkit/core/i18n";
import { Button } from "@anvilkit/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@anvilkit/ui/dialog";
import { Input } from "@anvilkit/ui/input";
import * as React from "react";

/**
 * One dialog for both create and rename — pass `initialName` + labels. Exported
 * as `CreateFolderDialog` / `RenameFolderDialog` thin aliases from the barrel.
 */
export interface FolderNameDialogProps {
	readonly open: boolean;
	readonly onOpenChange: (open: boolean) => void;
	readonly onSubmit: (name: string) => void | Promise<void>;
	readonly title?: string;
	readonly submitLabel?: string;
	readonly initialName?: string;
}

/** Dialog used to create or rename a folder. */
export function FolderNameDialog({
	open,
	onOpenChange,
	onSubmit,
	title,
	submitLabel,
	initialName = "",
}: FolderNameDialogProps) {
	const msg = useMsg();
	// Host-provided labels win; otherwise fall back to the localized defaults.
	const resolvedTitle = title ?? msg("assetManager.dialog.newFolderTitle");
	const resolvedSubmit = submitLabel ?? msg("assetManager.button.create");
	const [name, setName] = React.useState(initialName);
	const [busy, setBusy] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);

	// Re-seed the name when the dialog (re)opens for a different folder. The
	// transient `error` is cleared on close (requestClose) rather than reset
	// here, so the effect only ever sets state that derives from `initialName`.
	React.useEffect(() => {
		if (open) {
			setName(initialName);
		}
	}, [open, initialName]);

	// Close the dialog and drop any stale error so the next open is clean —
	// done in the close handler instead of a prop-reactive effect.
	function requestClose() {
		setError(null);
		onOpenChange(false);
	}

	async function handleSubmit() {
		const trimmed = name.trim();
		if (trimmed === "" || busy) return;
		setBusy(true);
		setError(null);
		try {
			await onSubmit(trimmed);
			onOpenChange(false);
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: msg("assetManager.dialog.folderSaveError"),
			);
		} finally {
			setBusy(false);
		}
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (busy) return;
				if (next) {
					onOpenChange(true);
				} else {
					requestClose();
				}
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{resolvedTitle}</DialogTitle>
				</DialogHeader>
				<Input
					value={name}
					placeholder={msg("assetManager.dialog.folderNamePlaceholder")}
					data-testid="ak-folder-name-input"
					onChange={(event) => setName(event.currentTarget.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") void handleSubmit();
					}}
				/>
				{error ? (
					<p
						role="alert"
						className="text-sm text-[var(--ak-studio-danger-fg,#dc2626)]"
					>
						{error}
					</p>
				) : null}
				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						disabled={busy}
						onClick={requestClose}
					>
						{msg("assetManager.button.cancel")}
					</Button>
					<Button
						type="button"
						disabled={busy || name.trim() === ""}
						onClick={() => void handleSubmit()}
					>
						{busy ? msg("assetManager.dialog.saveProgress") : resolvedSubmit}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
