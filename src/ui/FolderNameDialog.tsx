"use client";

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

export function FolderNameDialog({
	open,
	onOpenChange,
	onSubmit,
	title = "New folder",
	submitLabel = "Create",
	initialName = "",
}: FolderNameDialogProps) {
	const [name, setName] = React.useState(initialName);
	const [busy, setBusy] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);

	// Re-seed when the dialog (re)opens for a different folder.
	React.useEffect(() => {
		if (open) {
			setName(initialName);
			setError(null);
		}
	}, [open, initialName]);

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
				cause instanceof Error ? cause.message : "Could not save the folder.",
			);
		} finally {
			setBusy(false);
		}
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!busy) onOpenChange(next);
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
				</DialogHeader>
				<Input
					value={name}
					placeholder="Folder name"
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
						onClick={() => onOpenChange(false)}
					>
						Cancel
					</Button>
					<Button
						type="button"
						disabled={busy || name.trim() === ""}
						onClick={() => void handleSubmit()}
					>
						{busy ? "Saving…" : submitLabel}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
