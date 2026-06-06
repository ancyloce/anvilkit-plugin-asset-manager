"use client";

import { useMsg } from "@anvilkit/core/i18n";
import { Button } from "@anvilkit/ui/button";
import * as React from "react";

import type { AssetFolder } from "../types/folders.js";

/** dataTransfer MIME for an asset-id drag payload (native HTML5 DnD, no @dnd-kit). */
export const ASSET_DRAG_MIME = "application/x-anvilkit-assets";

export interface FolderTreeProps {
	/** Child folders of the current folder. */
	readonly folders: readonly AssetFolder[];
	readonly currentFolderId: string | null;
	readonly onNavigate: (folderId: string | null) => void;
	/** Drop handler for an asset-id payload dragged onto a folder row. */
	readonly onDropAssets?: (
		assetIds: readonly string[],
		folderId: string | null,
	) => void;
}

export function FolderTree({
	folders,
	currentFolderId,
	onNavigate,
	onDropAssets,
}: FolderTreeProps) {
	const msg = useMsg();
	const [dropTarget, setDropTarget] = React.useState<string | null>(null);

	const handleDrop = (folderId: string) => (event: React.DragEvent) => {
		event.preventDefault();
		setDropTarget(null);
		if (onDropAssets === undefined) return;
		try {
			const raw = event.dataTransfer.getData(ASSET_DRAG_MIME);
			const assetIds = raw ? (JSON.parse(raw) as readonly string[]) : [];
			if (Array.isArray(assetIds) && assetIds.length > 0) {
				onDropAssets(assetIds, folderId);
			}
		} catch {
			/* malformed payload — ignore */
		}
	};

	if (folders.length === 0) return null;
	const droppable = onDropAssets !== undefined;
	return (
		<ul
			aria-label={msg("assetManager.tree.label")}
			data-testid="ak-folder-tree"
			className="flex flex-col gap-1"
		>
			{folders.map((folder) => (
				<li key={folder.id}>
					<Button
						type="button"
						variant={folder.id === currentFolderId ? "secondary" : "ghost"}
						size="sm"
						className="w-full justify-start"
						data-folder-id={folder.id}
						data-drop-target={dropTarget === folder.id ? "" : undefined}
						// Native HTML5 DnD has no reliable AT affordance; the title
						// surfaces the drop equivalence. The sanctioned keyboard path
						// is the MoveTargetPicker dialog.
						title={
							droppable
								? msg("assetManager.tree.dropHint").replace(
										"{name}",
										folder.name,
									)
								: undefined
						}
						onClick={() => onNavigate(folder.id)}
						onDragOver={
							onDropAssets
								? (event) => {
										event.preventDefault();
										setDropTarget(folder.id);
									}
								: undefined
						}
						onDragLeave={
							onDropAssets
								? () =>
										setDropTarget((current) =>
											current === folder.id ? null : current,
										)
								: undefined
						}
						onDrop={onDropAssets ? handleDrop(folder.id) : undefined}
					>
						{folder.name} ({folder.counts.assets})
					</Button>
				</li>
			))}
		</ul>
	);
}
