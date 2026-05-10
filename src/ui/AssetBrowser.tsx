import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@anvilkit/ui/card";
import { Input } from "@anvilkit/ui/input";
import * as React from "react";

import { inferAssetKind } from "../infer-kind.js";
import type { AssetKind, UploadResult } from "../types.js";

const KIND_FILTERS: readonly AssetKind[] = [
	"image",
	"video",
	"audio",
	"font",
	"document",
];

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
	 * Optional metadata-edit affordance. When provided each row renders
	 * an "Edit" action — typically to open a `MetadataPanel` dialog so
	 * the user can rename + retag the asset.
	 */
	readonly onEdit?: (asset: UploadResult) => void;
	/**
	 * When `true`, renders the search input + kind chip row above the
	 * list. Off by default so existing AssetBrowser embeds (which
	 * pre-filter at the host layer) keep their previous chrome.
	 */
	readonly searchEnabled?: boolean;
	/**
	 * Page size used by the "Load more" affordance once the visible
	 * slice exceeds this number. Defaults to 100.
	 */
	readonly pageSize?: number;
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
const DEFAULT_PAGE_SIZE = 100;
const OVERSCAN = 4;

export function AssetBrowser({
	assets,
	onInsert,
	onDelete,
	onReplace,
	onEdit,
	searchEnabled = false,
	pageSize = DEFAULT_PAGE_SIZE,
	virtualizeThreshold = DEFAULT_VIRTUALIZE_THRESHOLD,
	itemHeight = DEFAULT_ITEM_HEIGHT,
	maxHeight = DEFAULT_MAX_HEIGHT,
}: AssetBrowserProps) {
	const [activeIndex, setActiveIndex] = React.useState(
		assets.length > 0 ? 0 : -1,
	);
	const [scrollTop, setScrollTop] = React.useState(0);
	const [query, setQuery] = React.useState("");
	const [activeKinds, setActiveKinds] = React.useState<readonly AssetKind[]>(
		[],
	);
	const [pageLimit, setPageLimit] = React.useState(pageSize);
	const buttonRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
	const scrollContainerRef = React.useRef<HTMLDivElement | null>(null);

	const filteredAssets = React.useMemo(() => {
		if (!searchEnabled) return assets;
		const lower = query.trim().toLowerCase();
		return assets.filter((asset) => {
			if (activeKinds.length > 0) {
				if (!activeKinds.includes(inferAssetKind(asset))) return false;
			}
			if (lower === "") return true;
			if (asset.id.toLowerCase().includes(lower)) return true;
			if (asset.name?.toLowerCase().includes(lower)) return true;
			if (asset.meta?.mimeType?.toLowerCase().includes(lower)) return true;
			if (asset.tags?.some((tag) => tag.toLowerCase().includes(lower))) {
				return true;
			}
			return false;
		});
	}, [assets, activeKinds, query, searchEnabled]);

	const visibleSlice = React.useMemo(
		() => (searchEnabled ? filteredAssets.slice(0, pageLimit) : filteredAssets),
		[filteredAssets, pageLimit, searchEnabled],
	);

	const total = visibleSlice.length;
	const isVirtualized = total > virtualizeThreshold;
	const hasMore = searchEnabled && filteredAssets.length > visibleSlice.length;

	React.useEffect(() => {
		if (total === 0) {
			setActiveIndex(-1);
			return;
		}

		setActiveIndex((currentIndex) =>
			currentIndex >= 0 && currentIndex < total ? currentIndex : 0,
		);
	}, [total]);

	function moveFocus(nextIndex: number) {
		if (total === 0) {
			return;
		}

		const clampedIndex = Math.max(0, Math.min(nextIndex, total - 1));
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
			queueMicrotask(() => {
				buttonRefs.current[clampedIndex]?.focus();
			});
			return;
		}

		buttonRefs.current[clampedIndex]?.focus();
	}

	function toggleKind(kind: AssetKind) {
		setActiveKinds((current) =>
			current.includes(kind)
				? current.filter((entry) => entry !== kind)
				: [...current, kind],
		);
	}

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
				? visibleSlice.slice(firstVisible, lastVisible + 1)
				: visibleSlice;

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
				{onEdit !== undefined ? (
					<button
						aria-label={`Edit asset ${asset.id}`}
						data-asset-action="edit"
						onClick={() => {
							onEdit(asset);
						}}
						type="button"
					>
						Edit
					</button>
				) : null}
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

	const filterRow = searchEnabled ? (
		<div data-asset-manager-filters>
			<Input
				aria-label="Search assets"
				onChange={(event) => {
					setQuery(event.target.value);
					setPageLimit(pageSize);
				}}
				placeholder="Search by name, tag, or MIME"
				value={query}
			/>
			<div aria-label="Asset kind filters" role="group">
				{KIND_FILTERS.map((kind) => {
					const active = activeKinds.includes(kind);
					return (
						<button
							aria-label={`Filter ${kind} assets`}
							aria-pressed={active}
							data-asset-kind-filter={kind}
							key={kind}
							onClick={() => {
								toggleKind(kind);
								setPageLimit(pageSize);
							}}
							type="button"
						>
							{kind}
						</button>
					);
				})}
			</div>
		</div>
	) : null;

	if (total === 0) {
		const emptyLabel =
			searchEnabled && (query !== "" || activeKinds.length > 0)
				? "No assets match the current filters."
				: "No assets uploaded yet.";
		return (
			<Card>
				<CardHeader>
					<CardTitle>Asset browser</CardTitle>
					<CardDescription>
						Validated assets currently registered in memory.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{filterRow}
					<ul aria-label="Assets" role="list">
						<li role="listitem">{emptyLabel}</li>
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
					{filterRow}
					<ul aria-label="Assets" role="list">
						{visibleAssets.map((asset, offset) => renderRow(asset, offset))}
					</ul>
					{hasMore ? (
						<button
							data-asset-action="load-more"
							onClick={() => {
								setPageLimit((current) => current + pageSize);
							}}
							type="button"
						>
							Load more
						</button>
					) : null}
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
				{filterRow}
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
				{hasMore ? (
					<button
						data-asset-action="load-more"
						onClick={() => {
							setPageLimit((current) => current + pageSize);
						}}
						type="button"
					>
						Load more
					</button>
				) : null}
			</CardContent>
		</Card>
	);
}
