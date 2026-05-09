import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@anvilkit/ui/card";
import { Progress } from "@anvilkit/ui/progress";
import * as React from "react";

import type {
	AssetManagerOptions,
	AssetRegistry,
	UploadResult,
} from "../types.js";
import { validateUploadResult } from "../validate-upload-result.js";
import { AssetBrowser } from "./AssetBrowser.js";
import { DeleteAssetDialog } from "./DeleteAssetDialog.js";
import { ReplaceAssetDialog } from "./ReplaceAssetDialog.js";
import { UploadButton, type UploadProgressSnapshot } from "./UploadButton.js";

export interface AssetManagerUIProps
	extends Pick<
		AssetManagerOptions,
		"acceptedMimeTypes" | "maxFileSize" | "uploader" | "urlAllowlist"
	> {
	readonly registry: AssetRegistry;
	readonly onAssetInserted?: (asset: UploadResult) => void;
}

export function AssetManagerUI({
	acceptedMimeTypes,
	maxFileSize,
	onAssetInserted,
	registry,
	uploader,
	urlAllowlist,
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

	React.useEffect(() => {
		setAssets(registry.list());
		const unsubscribe = registry.subscribe(() => {
			setAssets(registry.list());
		});
		return unsubscribe;
	}, [registry]);

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
			{ urlAllowlist },
		);
		registry.replace(asset.id, validated);
		setPendingReplace(null);
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
					maxFileSize={maxFileSize}
					onProgress={setProgress}
					onUploaded={handleUploaded}
					uploader={uploader}
					urlAllowlist={urlAllowlist}
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
					onInsert={(asset) => {
						onAssetInserted?.(asset);
					}}
					onDelete={(asset) => {
						setPendingDelete(asset);
					}}
					onReplace={(asset) => {
						setPendingReplace(asset);
					}}
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
			</CardContent>
		</Card>
	);
}
