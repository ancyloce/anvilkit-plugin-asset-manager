"use client";

import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@anvilkit/ui/card";
import { Progress } from "@anvilkit/ui/progress";
import * as React from "react";

import type { AssetManagerOptions } from "../types/options.js";
import type {
	AssetRegistry,
	UploadAdapter,
	UploadResult,
} from "../types/types.js";
import { validateUploadResult } from "../utils/validate-upload-result.js";
import { AssetBrowser } from "./AssetBrowser.js";
import { AssetCommandPalette } from "./AssetCommandPalette.js";
import { DeleteAssetDialog } from "./DeleteAssetDialog.js";
import { MetadataPanel } from "./MetadataPanel.js";
import { ReplaceAssetDialog } from "./ReplaceAssetDialog.js";
import { UploadButton, type UploadProgressSnapshot } from "./UploadButton.js";

export interface AssetManagerUIProps
	extends Pick<
		AssetManagerOptions,
		| "acceptedMimeTypes"
		| "maxFileSize"
		| "dataUrlAllowlistOptIn"
		| "allowMixedScriptHostnames"
	> {
	/**
	 * Binary uploader. Required at the UI boundary even though
	 * `AssetManagerOptions.uploader` is optional — the plugin passes the
	 * resolved (defaulted) uploader.
	 */
	readonly uploader: UploadAdapter;
	readonly registry: AssetRegistry;
	readonly onAssetInserted?: (asset: UploadResult) => void;
	/**
	 * When `true`, exposes the search input + kind chips on the embedded
	 * `AssetBrowser` and enables Cmd-K / Ctrl-K to open the
	 * `AssetCommandPalette`. Defaults to `true` because Phase 3 is the
	 * library-management milestone — hosts that want the lean Phase 1
	 * chrome can opt out.
	 */
	readonly searchEnabled?: boolean;
}

export function AssetManagerUI({
	acceptedMimeTypes,
	allowMixedScriptHostnames,
	dataUrlAllowlistOptIn,
	maxFileSize,
	onAssetInserted,
	registry,
	searchEnabled = true,
	uploader,
}: AssetManagerUIProps) {
	const [assets, setAssets] = React.useState<readonly UploadResult[]>(() =>
		registry.list(),
	);
	const [progress, setProgress] = React.useState<UploadProgressSnapshot | null>(
		null,
	);
	const [pendingDelete, setPendingDelete] = React.useState<UploadResult | null>(
		null,
	);
	const [pendingReplace, setPendingReplace] =
		React.useState<UploadResult | null>(null);
	const [pendingEdit, setPendingEdit] = React.useState<UploadResult | null>(
		null,
	);
	const [paletteOpen, setPaletteOpen] = React.useState(false);

	React.useEffect(() => {
		setAssets(registry.list());
		const unsubscribe = registry.subscribe(() => {
			setAssets(registry.list());
		});
		return unsubscribe;
	}, [registry]);

	React.useEffect(() => {
		if (!searchEnabled) return;
		function handler(event: KeyboardEvent) {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				setPaletteOpen((current) => !current);
			}
		}
		window.addEventListener("keydown", handler);
		return () => {
			window.removeEventListener("keydown", handler);
		};
	}, [searchEnabled]);

	function handleUploaded(asset: UploadResult) {
		const stored = registry.register(asset);
		onAssetInserted?.(stored);
	}

	async function handleConfirmDelete(asset: UploadResult) {
		registry.delete(asset.id);
		setPendingDelete(null);
	}

	async function handleConfirmReplace(asset: UploadResult, file: File) {
		const uploaded = await uploader(file);
		const validated = validateUploadResult(
			{
				...uploaded,
				meta: {
					size: file.size,
					...(file.type ? { mimeType: file.type } : {}),
					...(uploaded.meta ?? {}),
				},
			},
			{ dataUrlAllowlistOptIn, allowMixedScriptHostnames },
		);
		registry.replace(asset.id, validated);
		setPendingReplace(null);
	}

	async function handleConfirmEdit(
		asset: UploadResult,
		next: { readonly name: string; readonly tags: readonly string[] },
	) {
		if (next.name !== "" && next.name !== asset.name) {
			registry.rename(asset.id, next.name);
		}
		registry.setTags(asset.id, next.tags);
		setPendingEdit(null);
	}

	const showProgress = progress !== null && progress.total > 0;
	const percent = showProgress
		? Math.round((progress.completed / progress.total) * 100)
		: 0;

	return (
		<Card>
			<CardHeader>
				<CardTitle>Asset manager</CardTitle>
				<CardDescription>
					Upload via the configured adapter, then insert a validated asset
					reference.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<UploadButton
					acceptedMimeTypes={acceptedMimeTypes}
					allowMixedScriptHostnames={allowMixedScriptHostnames}
					dataUrlAllowlistOptIn={dataUrlAllowlistOptIn}
					maxFileSize={maxFileSize}
					onProgress={setProgress}
					onUploaded={handleUploaded}
					uploader={uploader}
				/>
				{showProgress ? (
					<div data-asset-manager-progress>
						<Progress aria-label="Batch upload progress" value={percent} />
						<p aria-live="polite" role="status">
							Uploading {progress.completed} of {progress.total}
						</p>
					</div>
				) : null}
				<AssetBrowser
					assets={assets}
					onDelete={(asset) => {
						setPendingDelete(asset);
					}}
					onEdit={(asset) => {
						setPendingEdit(asset);
					}}
					onInsert={(asset) => {
						onAssetInserted?.(asset);
					}}
					onReplace={(asset) => {
						setPendingReplace(asset);
					}}
					searchEnabled={searchEnabled}
				/>
				<DeleteAssetDialog
					asset={pendingDelete}
					onCancel={() => {
						setPendingDelete(null);
					}}
					onConfirm={handleConfirmDelete}
				/>
				<ReplaceAssetDialog
					acceptedMimeTypes={acceptedMimeTypes}
					asset={pendingReplace}
					maxFileSize={maxFileSize}
					onCancel={() => {
						setPendingReplace(null);
					}}
					onConfirm={handleConfirmReplace}
				/>
				<MetadataPanel
					asset={pendingEdit}
					onCancel={() => {
						setPendingEdit(null);
					}}
					onConfirm={handleConfirmEdit}
				/>
				{searchEnabled ? (
					<AssetCommandPalette
						onOpenChange={setPaletteOpen}
						onSelect={(asset) => {
							onAssetInserted?.(asset);
						}}
						open={paletteOpen}
						registry={registry}
					/>
				) : null}
			</CardContent>
		</Card>
	);
}
