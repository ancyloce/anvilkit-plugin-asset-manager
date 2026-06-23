"use client";

import { useMsg } from "@anvilkit/core/i18n";
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

/** Props for the complete standalone asset manager UI. */
export interface AssetManagerUIProps
	extends Pick<
		AssetManagerOptions,
		| "acceptedFileExtensions"
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
	/**
	 * Optional content rendered above the browser's filter row — e.g. a
	 * `FolderBreadcrumb` + `FolderTree` for folder navigation (PRD 0002 §7.4).
	 * The host wires these to the resolved data source / composite source.
	 */
	readonly aboveFilters?: React.ReactNode;
	/** Make asset rows draggable so they can be dropped onto a `FolderTree`. */
	readonly draggableRows?: boolean;
}

/**
 * Render the bundled asset-manager browser UI.
 *
 * This component wires the upload button, progress display, searchable asset
 * browser, command palette, delete/replace dialogs, and metadata editor around a
 * caller-provided registry and uploader. It is optional; headless integrations
 * can use the plugin runtime and registry APIs directly.
 */
export function AssetManagerUI({
	acceptedFileExtensions,
	acceptedMimeTypes,
	allowMixedScriptHostnames,
	aboveFilters,
	dataUrlAllowlistOptIn,
	draggableRows,
	maxFileSize,
	onAssetInserted,
	registry,
	searchEnabled = true,
	uploader,
}: AssetManagerUIProps) {
	const msg = useMsg();
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

	// Stable identities for the AssetBrowser callbacks so a re-render here (e.g.
	// opening a dialog via the `pending*` state) doesn't hand the browser fresh
	// functions and re-render every memoized asset row.
	const handleBrowserDelete = React.useCallback((asset: UploadResult) => {
		setPendingDelete(asset);
	}, []);
	const handleBrowserEdit = React.useCallback((asset: UploadResult) => {
		setPendingEdit(asset);
	}, []);
	const handleBrowserInsert = React.useCallback(
		(asset: UploadResult) => {
			onAssetInserted?.(asset);
		},
		[onAssetInserted],
	);
	const handleBrowserReplace = React.useCallback((asset: UploadResult) => {
		setPendingReplace(asset);
	}, []);

	const showProgress = progress !== null && progress.total > 0;
	const percent = showProgress
		? Math.round((progress.completed / progress.total) * 100)
		: 0;

	return (
		<Card>
			<CardHeader>
				<CardTitle>{msg("assetManager.ui.title")}</CardTitle>
				<CardDescription>{msg("assetManager.ui.subtitle")}</CardDescription>
			</CardHeader>
			<CardContent>
					<UploadButton
						acceptedFileExtensions={acceptedFileExtensions}
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
						<Progress
							aria-label={msg("assetManager.upload.progressLabel")}
							value={percent}
						/>
						<p aria-live="polite" role="status">
							{msg("assetManager.upload.status")
								.replace("{completed}", String(progress.completed))
								.replace("{total}", String(progress.total))}
						</p>
					</div>
				) : null}
				<AssetBrowser
					assets={assets}
					onDelete={handleBrowserDelete}
					onEdit={handleBrowserEdit}
					onInsert={handleBrowserInsert}
					onReplace={handleBrowserReplace}
					searchEnabled={searchEnabled}
					{...(aboveFilters !== undefined ? { aboveFilters } : {})}
					{...(draggableRows !== undefined ? { draggableRows } : {})}
				/>
				<DeleteAssetDialog
					asset={pendingDelete}
					onCancel={() => {
						setPendingDelete(null);
					}}
					onConfirm={handleConfirmDelete}
				/>
					<ReplaceAssetDialog
						acceptedFileExtensions={acceptedFileExtensions}
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
