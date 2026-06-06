"use client";

import { useMsg } from "@anvilkit/core/i18n";
import { Button } from "@anvilkit/ui/button";
import * as React from "react";

export interface EmptyFolderStateProps {
	readonly onUpload?: () => void;
	readonly message?: string;
}

export function EmptyFolderState({ onUpload, message }: EmptyFolderStateProps) {
	const msg = useMsg();
	const resolvedMessage = message ?? msg("assetManager.folder.empty");
	return (
		<div
			data-testid="ak-empty-folder"
			className="flex flex-col items-center gap-2 p-6 text-center text-sm text-[var(--ak-studio-muted-fg)]"
		>
			<p>{resolvedMessage}</p>
			{onUpload ? (
				<Button type="button" variant="outline" size="sm" onClick={onUpload}>
					{msg("assetManager.upload.toFolder")}
				</Button>
			) : null}
		</div>
	);
}
