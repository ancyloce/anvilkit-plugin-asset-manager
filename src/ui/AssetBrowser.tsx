import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@anvilkit/ui/card";
import * as React from "react";

import type { UploadResult } from "../types.js";

export interface AssetBrowserProps {
	readonly assets: readonly UploadResult[];
	readonly onInsert: (asset: UploadResult) => void;
}

export function AssetBrowser({ assets, onInsert }: AssetBrowserProps) {
	const [activeIndex, setActiveIndex] = React.useState(
		assets.length > 0 ? 0 : -1,
	);
	const buttonRefs = React.useRef<Array<HTMLButtonElement | null>>([]);

	React.useEffect(() => {
		if (assets.length === 0) {
			setActiveIndex(-1);
			return;
		}

		setActiveIndex((currentIndex) =>
			currentIndex >= 0 && currentIndex < assets.length ? currentIndex : 0,
		);
	}, [assets.length]);

	function moveFocus(nextIndex: number) {
		if (assets.length === 0) {
			return;
		}

		const clampedIndex = Math.max(0, Math.min(nextIndex, assets.length - 1));
		setActiveIndex(clampedIndex);
		buttonRefs.current[clampedIndex]?.focus();
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Asset browser</CardTitle>
				<CardDescription>
					Validated assets currently registered in memory.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<ul aria-label="Assets" role="list">
					{assets.length === 0 ? (
						<li role="listitem">No assets uploaded yet.</li>
					) : (
						assets.map((asset, index) => (
							<li key={asset.id} role="listitem">
								<button
									aria-label={`Insert asset ${asset.id}`}
									onClick={() => {
										onInsert(asset);
									}}
									onFocus={() => {
										setActiveIndex(index);
									}}
									onKeyDown={(event) => {
										if (event.key === "ArrowDown") {
											event.preventDefault();
											moveFocus(index + 1);
											return;
										}

										if (event.key === "ArrowUp") {
											event.preventDefault();
											moveFocus(index - 1);
											return;
										}

										if (event.key === "Enter" || event.key === " ") {
											event.preventDefault();
											onInsert(asset);
										}
									}}
									ref={(node) => {
										buttonRefs.current[index] = node;
									}}
									tabIndex={activeIndex === index ? 0 : -1}
									type="button"
								>
									<span>{asset.id}</span>
									<span>{asset.meta?.mimeType ?? "unknown type"}</span>
								</button>
							</li>
						))
					)}
				</ul>
			</CardContent>
		</Card>
	);
}
