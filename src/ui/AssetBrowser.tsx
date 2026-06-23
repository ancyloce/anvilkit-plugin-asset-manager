"use client";

import { useMsg } from "@anvilkit/core/i18n";
import { Button } from "@anvilkit/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@anvilkit/ui/card";
import { Input } from "@anvilkit/ui/input";
import { Windowed } from "@anvilkit/ui/windowed";
import * as React from "react";
import type { AssetKind, UploadResult } from "../types/types.js";
import { inferAssetKind } from "../utils/infer-kind.js";
import { ASSET_DRAG_MIME } from "./FolderTree.js";

const KIND_FILTERS: readonly AssetKind[] = [
	"image",
	"video",
	"audio",
	"font",
	"document",
];

/** Props for the reusable asset browser grid/list component. */
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
	 * Optional content rendered above the filter row — typically a folder
	 * breadcrumb + tree + source tabs (PRD 0002 §7.4). Purely additive.
	 */
	readonly aboveFilters?: React.ReactNode;
	/**
	 * When `true`, asset rows are draggable carrying an asset-id payload
	 * (`ASSET_DRAG_MIME`) so they can be dropped onto a `FolderTree` row.
	 */
	readonly draggableRows?: boolean;
	/**
	 * Page size used by the "Load more" affordance once the visible
	 * slice exceeds this number. Defaults to 100.
	 */
	readonly pageSize?: number;
	/**
	 * Threshold above which the list windows visible items. Below the
	 * threshold the entire list renders inline so small libraries skip
	 * scroll math entirely. Forwarded to the shared `Windowed` primitive.
	 */
	readonly virtualizeThreshold?: number;
	/**
	 * Pixel height of a single row when virtualizing.
	 *
	 * **Fixed-height contract:** the windowing math assumes every row is
	 * roughly `itemHeight` tall. Rows that wrap or vary in height (long
	 * names, thumbnails) will desync the scroll-into-view calculation. Keep
	 * rows uniform, or raise `virtualizeThreshold` so the list renders
	 * inline instead.
	 */
	readonly itemHeight?: number;
	/** Pixel height of the scroll container when virtualizing. */
	readonly maxHeight?: number;
}

const DEFAULT_VIRTUALIZE_THRESHOLD = 50;
const DEFAULT_ITEM_HEIGHT = 56;
const DEFAULT_MAX_HEIGHT = 400;
const DEFAULT_PAGE_SIZE = 100;

interface AssetFilterRowProps {
	readonly query: string;
	readonly onQueryChange: (value: string) => void;
	readonly activeKinds: readonly AssetKind[];
	readonly onToggleKind: (kind: AssetKind) => void;
}

/**
 * Search input + kind-filter chip row. Purely presentational — query text,
 * active kinds, and the page-size reset all live in the parent `AssetBrowser`.
 */
function AssetFilterRow({
	query,
	onQueryChange,
	activeKinds,
	onToggleKind,
}: AssetFilterRowProps) {
	const msg = useMsg();
	return (
		<div data-asset-manager-filters>
			<Input
				aria-label={msg("assetManager.browser.searchLabel")}
				onChange={(event) => {
					onQueryChange(event.target.value);
				}}
				placeholder={msg("assetManager.browser.searchPlaceholder")}
				value={query}
			/>
			<div aria-label={msg("assetManager.browser.filterLabel")} role="group">
				{KIND_FILTERS.map((kind) => {
					const active = activeKinds.includes(kind);
					return (
						<Button
							aria-label={msg("assetManager.browser.filterByKind").replace(
								"{kind}",
								kind,
							)}
							aria-pressed={active}
							data-asset-kind-filter={kind}
							key={kind}
							onClick={() => {
								onToggleKind(kind);
							}}
							type="button"
							variant={active ? "secondary" : "ghost"}
							size="sm"
						>
							{msg(`assetManager.kind.${kind}`)}
						</Button>
					);
				})}
			</div>
		</div>
	);
}

interface AssetRowProps {
	readonly asset: UploadResult;
	readonly index: number;
	/**
	 * Whether this row holds the roving tabindex. A per-row boolean (not the
	 * shared `activeIndex`) so a focus move only re-renders the two rows whose
	 * active state flipped — every other memoized row sees an unchanged
	 * `isActive` and skips (R2).
	 */
	readonly isActive: boolean;
	readonly total: number;
	readonly draggableRows: boolean;
	readonly onInsert: (asset: UploadResult) => void;
	readonly onEdit?: (asset: UploadResult) => void;
	readonly onReplace?: (asset: UploadResult) => void;
	readonly onDelete?: (asset: UploadResult) => void;
	readonly onFocusRow: (index: number) => void;
	readonly onMoveFocus: (nextIndex: number) => void;
	readonly registerRow: (index: number, node: HTMLButtonElement | null) => void;
}

/**
 * One asset row: the insert button (drag payload + roving-tabindex keyboard
 * nav) plus the optional Edit / Replace / Delete actions. Focus bookkeeping
 * stays in the parent via `registerRow` / `onMoveFocus` so the row-ref array
 * keeps a single owner.
 */
const AssetRow = React.memo(function AssetRow({
	asset,
	index,
	isActive,
	total,
	draggableRows,
	onInsert,
	onEdit,
	onReplace,
	onDelete,
	onFocusRow,
	onMoveFocus,
	registerRow,
}: AssetRowProps) {
	const msg = useMsg();
	return (
		<>
			<button
				aria-label={msg("assetManager.browser.insert").replace(
					"{id}",
					asset.id,
				)}
				draggable={draggableRows}
				data-asset-draggable={draggableRows ? "" : undefined}
				onDragStart={
					draggableRows
						? (event) => {
								event.dataTransfer.setData(
									ASSET_DRAG_MIME,
									JSON.stringify([asset.id]),
								);
								event.dataTransfer.effectAllowed = "move";
							}
						: undefined
				}
				onClick={() => {
					onInsert(asset);
				}}
				onFocus={() => {
					onFocusRow(index);
				}}
				onKeyDown={(event) => {
					if (event.key === "ArrowDown") {
						event.preventDefault();
						onMoveFocus(index + 1);
						return;
					}

					if (event.key === "ArrowUp") {
						event.preventDefault();
						onMoveFocus(index - 1);
						return;
					}

					if (event.key === "Home") {
						event.preventDefault();
						onMoveFocus(0);
						return;
					}

					if (event.key === "End") {
						event.preventDefault();
						onMoveFocus(total - 1);
						return;
					}

					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						onInsert(asset);
					}
				}}
				ref={(node) => {
					registerRow(index, node);
				}}
				tabIndex={isActive ? 0 : -1}
				type="button"
			>
				<span>{asset.id}</span>
				<span>
					{asset.meta?.mimeType ?? msg("assetManager.browser.unknownMime")}
				</span>
			</button>
			{onEdit !== undefined ? (
				<Button
					aria-label={msg("assetManager.browser.edit").replace(
						"{id}",
						asset.id,
					)}
					data-asset-action="edit"
					onClick={() => {
						onEdit(asset);
					}}
					type="button"
					variant="ghost"
					size="sm"
				>
					{msg("assetManager.button.edit")}
				</Button>
			) : null}
			{onReplace !== undefined ? (
				<Button
					aria-label={msg("assetManager.browser.replace").replace(
						"{id}",
						asset.id,
					)}
					data-asset-action="replace"
					onClick={() => {
						onReplace(asset);
					}}
					type="button"
					variant="ghost"
					size="sm"
				>
					{msg("assetManager.button.replace")}
				</Button>
			) : null}
			{onDelete !== undefined ? (
				<Button
					aria-label={msg("assetManager.browser.delete").replace(
						"{id}",
						asset.id,
					)}
					data-asset-action="delete"
					onClick={() => {
						onDelete(asset);
					}}
					type="button"
					variant="ghost"
					size="sm"
				>
					{msg("assetManager.button.delete")}
				</Button>
			) : null}
		</>
	);
});

/** Asset grid and list browser with search, filters, paging, and actions. */
export function AssetBrowser({
	assets,
	onInsert,
	onDelete,
	onReplace,
	onEdit,
	searchEnabled = false,
	aboveFilters,
	draggableRows = false,
	pageSize = DEFAULT_PAGE_SIZE,
	virtualizeThreshold = DEFAULT_VIRTUALIZE_THRESHOLD,
	itemHeight = DEFAULT_ITEM_HEIGHT,
	maxHeight = DEFAULT_MAX_HEIGHT,
}: AssetBrowserProps) {
	const msg = useMsg();
	const [activeIndex, setActiveIndex] = React.useState(
		assets.length > 0 ? 0 : -1,
	);
	const [query, setQuery] = React.useState("");
	const [activeKinds, setActiveKinds] = React.useState<readonly AssetKind[]>(
		[],
	);
	// Track how many *extra* pages "Load more" has revealed rather than copying
	// `pageSize` into state. The visible ceiling is then derived from the live
	// `pageSize` prop below, so changing the prop never leaves a stale limit.
	const [extraPages, setExtraPages] = React.useState(0);
	const pageLimit = pageSize * (extraPages + 1);
	const buttonRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
	// When a keyboard jump targets a row outside the current virtualized
	// window the row is not mounted yet. We record the wanted index here;
	// `Windowed` scrolls to `activeIndex`, and the row's `ref` callback (below)
	// focuses it the instant it mounts — no rAF/flushSync timing guesswork.
	const pendingFocusRef = React.useRef<number | null>(null);

	// Lowercase each asset's searchable fields once per `assets` identity
	// rather than on every keystroke. Fields are joined with a NUL
	// (\u0000) so one `includes` covers id/name/mime/tags while keeping
	// the original per-field match semantics: a user query never
	// contains NUL, so it cannot match across the field boundary.
	const searchIndex = React.useMemo(() => {
		if (!searchEnabled) return null;
		return assets.map((asset) => ({
			asset,
			kind: inferAssetKind(asset),
			haystack: [
				asset.id,
				asset.name ?? "",
				asset.meta?.mimeType ?? "",
				...(asset.tags ?? []),
			]
				.join("\u0000")
				.toLowerCase(),
		}));
	}, [assets, searchEnabled]);

	const filteredAssets = React.useMemo(() => {
		if (!searchEnabled || searchIndex === null) return assets;
		const lower = query.trim().toLowerCase();
		const hasKindFilter = activeKinds.length > 0;
		if (lower === "" && !hasKindFilter) return assets;
		// O(1) membership instead of Array.includes() on every iteration.
		const activeKindSet = hasKindFilter
			? new Set<AssetKind>(activeKinds)
			: null;
		const result: UploadResult[] = [];
		for (const entry of searchIndex) {
			if (activeKindSet && !activeKindSet.has(entry.kind)) continue;
			if (lower === "" || entry.haystack.includes(lower)) {
				result.push(entry.asset);
			}
		}
		return result;
	}, [assets, searchIndex, activeKinds, query, searchEnabled]);

	const visibleSlice = React.useMemo(
		() => (searchEnabled ? filteredAssets.slice(0, pageLimit) : filteredAssets),
		[filteredAssets, pageLimit, searchEnabled],
	);

	const total = visibleSlice.length;
	const hasMore = searchEnabled && filteredAssets.length > visibleSlice.length;

	// Clamp the stored index into the current list at render time instead of
	// chasing `total` with an effect (which forced an extra render and could
	// transiently desync). `setActiveIndex` still records raw user intent via
	// focus/keyboard; this derived value is what the rows + `Windowed` read.
	const effectiveActiveIndex =
		total === 0
			? -1
			: activeIndex >= 0 && activeIndex < total
				? activeIndex
				: 0;

	// All five handlers are `useCallback`-stable so the values threaded into
	// `renderRow` (and thus each memoized `AssetRow`) keep a constant identity
	// across renders that don't change them — see `renderRow` below.
	const focusRow = React.useCallback((index: number): boolean => {
		const node = buttonRefs.current[index];
		if (node) {
			node.focus();
			return true;
		}
		return false;
	}, []);

	const moveFocus = React.useCallback(
		(nextIndex: number) => {
			if (total === 0) {
				return;
			}

			const clampedIndex = Math.max(0, Math.min(nextIndex, total - 1));
			pendingFocusRef.current = clampedIndex;
			setActiveIndex(clampedIndex);
			// Already-mounted rows (below threshold, or an adjacent visible row)
			// focus synchronously so keyboard nav is instant. For an off-window
			// jump the row mounts after `Windowed` scrolls to `activeIndex`; its
			// `ref` callback focuses it then.
			if (focusRow(clampedIndex)) {
				pendingFocusRef.current = null;
			}
		},
		[total, focusRow],
	);

	const registerRow = React.useCallback(
		(index: number, node: HTMLButtonElement | null) => {
			buttonRefs.current[index] = node;
			// Focus an off-window target the moment it mounts after a
			// scroll-into-view triggered by a keyboard jump.
			if (node && pendingFocusRef.current === index) {
				pendingFocusRef.current = null;
				node.focus();
			}
		},
		[],
	);

	// Reset to the first page whenever the query or kind filter changes so the
	// "Load more" cursor never points past a freshly-filtered, shorter list.
	const changeQuery = React.useCallback((value: string) => {
		setQuery(value);
		setExtraPages(0);
	}, []);

	const toggleKind = React.useCallback((kind: AssetKind) => {
		setActiveKinds((current) =>
			current.includes(kind)
				? current.filter((entry) => entry !== kind)
				: [...current, kind],
		);
		setExtraPages(0);
	}, []);

	// `Windowed` (as="ul") owns the <ul>/<li> + aria-posinset/aria-setsize; each
	// row's content (button, roving tabindex, keyboard nav, actions) lives in
	// `AssetRow`. Focus state stays here and is threaded down so behavior is
	// unchanged.
	const renderRow = React.useCallback(
		(asset: UploadResult, index: number) => (
			<AssetRow
				asset={asset}
				draggableRows={draggableRows}
				index={index}
				isActive={effectiveActiveIndex === index}
				onDelete={onDelete}
				onEdit={onEdit}
				onFocusRow={setActiveIndex}
				onInsert={onInsert}
				onMoveFocus={moveFocus}
				onReplace={onReplace}
				registerRow={registerRow}
				total={total}
			/>
		),
		[
			draggableRows,
			effectiveActiveIndex,
			moveFocus,
			onDelete,
			onEdit,
			onInsert,
			onReplace,
			registerRow,
			total,
		],
	);

	const searchRow = searchEnabled ? (
		<AssetFilterRow
			activeKinds={activeKinds}
			onQueryChange={changeQuery}
			onToggleKind={toggleKind}
			query={query}
		/>
	) : null;

	const filterRow = (
		<>
			{aboveFilters}
			{searchRow}
		</>
	);

	if (total === 0) {
		const emptyLabel =
			searchEnabled && (query !== "" || activeKinds.length > 0)
				? msg("assetManager.browser.emptyFiltered")
				: msg("assetManager.browser.empty");
		return (
			<Card>
				<CardHeader>
					<CardTitle>{msg("assetManager.browser.title")}</CardTitle>
					<CardDescription>
						{msg("assetManager.browser.subtitle")}
					</CardDescription>
				</CardHeader>
				<CardContent>
					{filterRow}
					<ul aria-label={msg("assetManager.browser.assetsLabel")}>
						<li>{emptyLabel}</li>
					</ul>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>{msg("assetManager.browser.title")}</CardTitle>
				<CardDescription>
					{msg("assetManager.browser.subtitle")}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{filterRow}
				<Windowed
					activeIndex={
						effectiveActiveIndex >= 0 ? effectiveActiveIndex : undefined
					}
					aria-label={msg("assetManager.browser.assetsLabel")}
					as="ul"
					data-testid="asset-browser-virtualized"
					estimateSize={itemHeight}
					items={visibleSlice}
					itemKey={(asset) => asset.id}
					maxHeight={maxHeight}
					renderItem={renderRow}
					threshold={virtualizeThreshold}
				/>
				{hasMore ? (
					<Button
						data-asset-action="load-more"
						onClick={() => {
							setExtraPages((current) => current + 1);
						}}
						type="button"
						variant="outline"
						size="sm"
					>
						{msg("assetManager.button.loadMore")}
					</Button>
				) : null}
			</CardContent>
		</Card>
	);
}
