"use client";

import { Button } from "@anvilkit/ui/button";
import * as React from "react";

export interface EmptyFolderStateProps {
	readonly onUpload?: () => void;
	readonly message?: string;
}

export function EmptyFolderState({
	onUpload,
	message = "This folder is empty.",
}: EmptyFolderStateProps) {
	return (
		<div
			data-testid="ak-empty-folder"
			className="flex flex-col items-center gap-2 p-6 text-center text-sm text-[var(--ak-studio-muted-fg)]"
		>
			<p>{message}</p>
			{onUpload ? (
				<Button type="button" variant="outline" size="sm" onClick={onUpload}>
					Drop files here or upload
				</Button>
			) : null}
		</div>
	);
}
