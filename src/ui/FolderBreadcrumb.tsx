"use client";

import * as React from "react";

import type { AssetFolder } from "../types/folders.js";

export interface FolderBreadcrumbProps {
	/** Root → … → current folder. Empty ⇒ at root. */
	readonly path: readonly AssetFolder[];
	readonly onNavigate: (folderId: string | null) => void;
	readonly rootLabel?: string;
}

export function FolderBreadcrumb({
	path,
	onNavigate,
	rootLabel = "All assets",
}: FolderBreadcrumbProps) {
	return (
		<nav
			aria-label="Folders"
			data-testid="ak-folder-breadcrumb"
			className="flex flex-wrap items-center gap-1 text-sm"
		>
			<button
				type="button"
				data-folder-crumb="root"
				aria-current={path.length === 0 ? "page" : undefined}
				className="hover:underline"
				onClick={() => onNavigate(null)}
			>
				{rootLabel}
			</button>
			{path.map((folder, index) => (
				<React.Fragment key={folder.id}>
					<span aria-hidden="true">›</span>
					<button
						type="button"
						data-folder-crumb={folder.id}
						aria-current={index === path.length - 1 ? "page" : undefined}
						className="hover:underline"
						onClick={() => onNavigate(folder.id)}
					>
						{folder.name}
					</button>
				</React.Fragment>
			))}
		</nav>
	);
}
