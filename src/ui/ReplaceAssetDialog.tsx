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

import { validateSelectedFile } from "../plugin.js";
import type { AssetManagerOptions } from "../types/options.js";
import type { UploadResult } from "../types/types.js";

export interface ReplaceAssetDialogProps
	extends Pick<AssetManagerOptions, "acceptedMimeTypes" | "maxFileSize"> {
	/** Asset to replace. `null` closes the dialog. */
	readonly asset: UploadResult | null;
	/**
	 * Receives the selected file. Typically calls
	 * `studioAssetSource.replace(asset.id, file)` or
	 * `registry.replace(asset.id, await uploader(file))`.
	 */
	readonly onConfirm: (asset: UploadResult, file: File) => void | Promise<void>;
	readonly onCancel: () => void;
}

export function ReplaceAssetDialog({
	acceptedMimeTypes,
	asset,
	maxFileSize,
	onCancel,
	onConfirm,
}: ReplaceAssetDialogProps) {
	const msg = useMsg();
	const inputRef = React.useRef<HTMLInputElement>(null);
	const [selectedFile, setSelectedFile] = React.useState<File | null>(null);
	const [error, setError] = React.useState<string | null>(null);
	const [busy, setBusy] = React.useState(false);

	const acceptAttr = React.useMemo(
		() => acceptedMimeTypes?.join(","),
		[acceptedMimeTypes],
	);

	// Clear the transient picker state on every close path (cancel, dismiss,
	// successful replace) so reopening for another asset starts fresh — without
	// reacting to the `asset` prop inside an effect.
	function resetPicker() {
		setSelectedFile(null);
		setError(null);
	}

	function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.[0];
		event.target.value = "";
		if (!file) {
			return;
		}
		try {
			validateSelectedFile(file, { acceptedMimeTypes, maxFileSize });
			setError(null);
			setSelectedFile(file);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setSelectedFile(null);
		}
	}

	async function handleConfirm() {
		if (asset === null || selectedFile === null || busy) {
			return;
		}
		setBusy(true);
		try {
			await onConfirm(asset, selectedFile);
			resetPicker();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	}

	function handleCancel() {
		resetPicker();
		onCancel();
	}

	function handleOpenChange(nextOpen: boolean) {
		if (!nextOpen && !busy) {
			handleCancel();
		}
	}

	const open = asset !== null;
	const label = asset?.name ?? asset?.id ?? "";

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{msg("assetManager.dialog.replaceTitle")}</DialogTitle>
					<DialogDescription>
						{label
							? msg("assetManager.dialog.replaceDescription").replace(
									"{label}",
									label,
								)
							: msg("assetManager.dialog.replaceDescriptionGeneric")}
					</DialogDescription>
				</DialogHeader>
				<input
					aria-label={msg("assetManager.dialog.replaceFileLabel")}
					data-testid="replace-asset-file-input"
					hidden
					onChange={handleFileChange}
					ref={inputRef}
					type="file"
					{...(acceptAttr ? { accept: acceptAttr } : {})}
				/>
				<div data-asset-manager-replace-state>
					<Button
						type="button"
						variant="outline"
						onClick={() => inputRef.current?.click()}
						disabled={busy}
					>
						{selectedFile
							? msg("assetManager.dialog.chooseFileDifferent")
							: msg("assetManager.dialog.chooseFile")}
					</Button>
					<p aria-live="polite" role="status">
						{selectedFile
							? msg("assetManager.dialog.fileSelected").replace(
									"{name}",
									selectedFile.name,
								)
							: msg("assetManager.dialog.noFileSelected")}
					</p>
					{error ? (
						<p data-asset-manager-replace-error role="alert">
							{error}
						</p>
					) : null}
				</div>
				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						onClick={handleCancel}
						disabled={busy}
					>
						{msg("assetManager.button.cancel")}
					</Button>
					<Button
						type="button"
						onClick={handleConfirm}
						disabled={busy || asset === null || selectedFile === null}
					>
						{busy
							? msg("assetManager.dialog.replaceProgress")
							: msg("assetManager.button.replace")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
