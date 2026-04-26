import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@anvilkit/ui/card";
import * as React from "react";

import type {
	AssetManagerOptions,
	AssetRegistry,
	UploadResult,
} from "../types.js";
import { AssetBrowser } from "./AssetBrowser.js";
import { UploadButton } from "./UploadButton.js";

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

	React.useEffect(() => {
		setAssets(registry.list());
	}, [registry]);

	function handleUploaded(asset: UploadResult) {
		const stored = registry.register(asset);
		const nextAssets = registry.list();
		setAssets(nextAssets);
		onAssetInserted?.(stored);
	}

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
					onUploaded={handleUploaded}
					uploader={uploader}
					urlAllowlist={urlAllowlist}
				/>
				<AssetBrowser
					assets={assets}
					onInsert={(asset) => {
						onAssetInserted?.(asset);
					}}
				/>
			</CardContent>
		</Card>
	);
}
