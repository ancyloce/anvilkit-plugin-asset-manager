"use client";

import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@anvilkit/ui/breadcrumb";
import { Button } from "@anvilkit/ui/button";
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
	const atRoot = path.length === 0;
	return (
		<Breadcrumb aria-label="Folders" data-testid="ak-folder-breadcrumb">
			<BreadcrumbList>
				<BreadcrumbItem>
					{atRoot ? (
						<BreadcrumbPage data-folder-crumb="root">
							{rootLabel}
						</BreadcrumbPage>
					) : (
						<Button
							type="button"
							variant="link"
							size="sm"
							className="h-auto p-0"
							data-folder-crumb="root"
							onClick={() => onNavigate(null)}
						>
							{rootLabel}
						</Button>
					)}
				</BreadcrumbItem>
				{path.map((folder, index) => {
					const isCurrent = index === path.length - 1;
					return (
						<React.Fragment key={folder.id}>
							<BreadcrumbSeparator />
							<BreadcrumbItem>
								{isCurrent ? (
									<BreadcrumbPage data-folder-crumb={folder.id}>
										{folder.name}
									</BreadcrumbPage>
								) : (
									<Button
										type="button"
										variant="link"
										size="sm"
										className="h-auto p-0"
										data-folder-crumb={folder.id}
										onClick={() => onNavigate(folder.id)}
									>
										{folder.name}
									</Button>
								)}
							</BreadcrumbItem>
						</React.Fragment>
					);
				})}
			</BreadcrumbList>
		</Breadcrumb>
	);
}
