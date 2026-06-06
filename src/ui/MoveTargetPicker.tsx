"use client";

import { useMsg } from "@anvilkit/core/i18n";
import { Button } from "@anvilkit/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@anvilkit/ui/dialog";
import * as React from "react";

import type { AssetFolder } from "../types/folders.js";

/**
 * Keyboard-accessible move-target picker — the a11y fallback for drag-to-folder.
 * Renders, inside a focus-trapping `<Dialog>`, a labelled `<ul>` of Tab-focusable
 * folder `<Button>`s plus a root option (no roving-tabindex listbox; each option
 * is an individually focusable, Enter/Space-activatable button).
 */
export interface MoveTargetPickerProps {
	readonly open: boolean;
	readonly onOpenChange: (open: boolean) => void;
	readonly folders: readonly AssetFolder[];
	readonly onPick: (folderId: string | null) => void | Promise<void>;
	readonly rootLabel?: string;
}

export function MoveTargetPicker({
	open,
	onOpenChange,
	folders,
	onPick,
	rootLabel,
}: MoveTargetPickerProps) {
	const msg = useMsg();
	const resolvedRootLabel = rootLabel ?? msg("assetManager.folder.root");
	const [busy, setBusy] = React.useState(false);

	async function pick(folderId: string | null) {
		if (busy) return;
		setBusy(true);
		try {
			await onPick(folderId);
			onOpenChange(false);
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
					<DialogTitle>{msg("assetManager.dialog.moveTitle")}</DialogTitle>
				</DialogHeader>
				<ul
					aria-label={msg("assetManager.dialog.moveTitle")}
					data-testid="ak-move-target-picker"
					className="flex max-h-72 flex-col gap-1 overflow-auto"
				>
					<li>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="w-full justify-start"
							data-move-target="root"
							disabled={busy}
							onClick={() => void pick(null)}
						>
							{resolvedRootLabel}
						</Button>
					</li>
					{folders.map((folder) => (
						<li key={folder.id}>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								className="w-full justify-start"
								data-move-target={folder.id}
								disabled={busy}
								onClick={() => void pick(folder.id)}
							>
								{folder.name}
							</Button>
						</li>
					))}
				</ul>
			</DialogContent>
		</Dialog>
	);
}
