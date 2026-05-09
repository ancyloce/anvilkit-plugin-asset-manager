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
	/**
	 * Optional delete affordance. When provided each row renders a
	 * "Delete" action that hands the asset back to the host — typically
	 * to open a `DeleteAssetDialog`.
	 */
	readonly onDelete?: (asset: UploadResult) => void;
	/**
	 * Optional replace affordance. When provided each row renders a
	 * "Replace" action — typically to open a `ReplaceAssetDialog`.
	 */
	readonly onReplace?: (asset: UploadResult) => void;
	/**
	 * Threshold above which the list windows visible items. Below the
	 * threshold the entire list renders inline so small libraries skip
	 * scroll math entirely.
	 */
	readonly virtualizeThreshold?: number;
	/** Pixel height of a single row when virtualizing. */
	readonly itemHeight?: number;
	/** Pixel height of the scroll container when virtualizing. */
	readonly maxHeight?: number;
}

const DEFAULT_VIRTUALIZE_THRESHOLD = 50;
const DEFAULT_ITEM_HEIGHT = 56;
const DEFAULT_MAX_HEIGHT = 400;
const OVERSCAN = 4;

export function AssetBrowser({
	assets,
	onInsert,
	onDelete,
	onReplace,
	virtualizeThreshold = DEFAULT_VIRTUALIZE_THRESHOLD,
	itemHeight = DEFAULT_ITEM_HEIGHT,
	maxHeight = DEFAULT_MAX_HEIGHT,
}: AssetBrowserProps) {
	const [activeIndex, setActiveIndex] = React.useState(
		assets.length > 0 ? 0 : -1,
	);
	const [scrollTop, setScrollTop] = React.useState(0);
	const buttonRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
	const scrollContainerRef = React.useRef<HTMLDivElement | null>(null);
	const isVirtualized = assets.length > virtualizeThreshold;

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

		if (isVirtualized && scrollContainerRef.current) {
			const targetTop = clampedIndex * itemHeight;
			const targetBottom = targetTop + itemHeight;
			const viewTop = scrollContainerRef.current.scrollTop;
			const viewBottom = viewTop + maxHeight;
			if (targetTop < viewTop) {
				scrollContainerRef.current.scrollTop = targetTop;
			} else if (targetBottom > viewBottom) {
				scrollContainerRef.current.scrollTop = targetBottom - maxHeight;
			}
			// In virtualized mode the target row may not be rendered yet —
			// defer focus to the next microtask so the windowed range can
			// repaint before we focus the button.
			queueMicrotask(() => {
				buttonRefs.current[clampedIndex]?.focus();
			});
			return;
		}

		buttonRefs.current[clampedIndex]?.focus();
	}

	const total = assets.length;
	const firstVisible = isVirtualized
		? Math.max(0, Math.floor(scrollTop / itemHeight) - OVERSCAN)
		: 0;
	const lastVisible = isVirtualized
		? Math.min(
				total - 1,
				Math.ceil((scrollTop + maxHeight) / itemHeight) + OVERSCAN,
			)
		: total - 1;

	const visibleAssets =
		total === 0
			? []
			: isVirtualized
				? assets.slice(firstVisible, lastVisible + 1)
				: assets;

	function renderRow(asset: UploadResult, index: number) {
		return (
			<li
				aria-posinset={index + 1}
				aria-setsize={total}
				key={asset.id}
				role="listitem"
			>
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

						if (event.key === "Home") {
							event.preventDefault();
							moveFocus(0);
							return;
						}

						if (event.key === "End") {
							event.preventDefault();
							moveFocus(total - 1);
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
				{onReplace !== undefined ? (
					<button
						aria-label={`Replace asset ${asset.id}`}
						data-asset-action="replace"
						onClick={() => {
							onReplace(asset);
						}}
						type="button"
					>
						Replace
					</button>
				) : null}
				{onDelete !== undefined ? (
					<button
						aria-label={`Delete asset ${asset.id}`}
						data-asset-action="delete"
						onClick={() => {
							onDelete(asset);
						}}
						type="button"
					>
						Delete
					</button>
				) : null}
			</li>
		);
	}

	if (total === 0) {
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
						<li role="listitem">No assets uploaded yet.</li>
					</ul>
				</CardContent>
			</Card>
		);
	}

	if (!isVirtualized) {
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
						{visibleAssets.map((asset, offset) => renderRow(asset, offset))}
					</ul>
				</CardContent>
			</Card>
		);
	}

	const totalHeight = total * itemHeight;
	const offsetY = firstVisible * itemHeight;

	return (
		<Card>
			<CardHeader>
				<CardTitle>Asset browser</CardTitle>
				<CardDescription>
					Validated assets currently registered in memory.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div
					data-asset-manager-virtual
					onScroll={(event) => {
						setScrollTop(event.currentTarget.scrollTop);
					}}
					ref={scrollContainerRef}
					style={{ height: maxHeight, overflowY: "auto", position: "relative" }}
				>
					<div style={{ height: totalHeight, position: "relative" }}>
						<ul
							aria-label="Assets"
							role="list"
							style={{
								margin: 0,
								padding: 0,
								position: "absolute",
								top: offsetY,
								left: 0,
								right: 0,
							}}
						>
							{visibleAssets.map((asset, offset) =>
								renderRow(asset, firstVisible + offset),
							)}
						</ul>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
