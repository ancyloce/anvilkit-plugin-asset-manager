"use client";

import { useMsg } from "@anvilkit/core/i18n";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@anvilkit/ui/dialog";
import { Input } from "@anvilkit/ui/input";
import * as React from "react";
import type { AssetRegistry, UploadResult } from "../types/types.js";
import { inferAssetKind } from "../utils/infer-kind.js";

/** Props for the command palette asset picker. */
export interface AssetCommandPaletteProps {
	/** Registry the palette searches against. */
	readonly registry: AssetRegistry;
	/** When `true`, the palette is shown. The host owns this state. */
	readonly open: boolean;
	/** Called when the palette is dismissed (Esc, click outside, after pick). */
	readonly onOpenChange: (open: boolean) => void;
	/**
	 * Invoked when a result is selected. The host typically calls
	 * `onAssetInserted` and closes the palette.
	 */
	readonly onSelect: (asset: UploadResult) => void;
	/**
	 * Maximum number of results rendered. Defaults to 20 — enough to
	 * surface relevant matches without ballooning the dialog height.
	 */
	readonly maxResults?: number;
}

const DEFAULT_MAX_RESULTS = 20;

/** Search palette for quickly finding and selecting registry assets. */
export function AssetCommandPalette({
	registry,
	open,
	onOpenChange,
	onSelect,
	maxResults = DEFAULT_MAX_RESULTS,
}: AssetCommandPaletteProps) {
	const msg = useMsg();
	const [query, setQuery] = React.useState("");
	const [results, setResults] = React.useState<readonly UploadResult[]>([]);
	const [activeIndex, setActiveIndex] = React.useState(0);
	const inputRef = React.useRef<HTMLInputElement | null>(null);
	const listRef = React.useRef<HTMLUListElement | null>(null);

	const refresh = React.useCallback(
		(nextQuery: string) => {
			const page = registry.search({
				query: nextQuery,
				limit: maxResults,
			});
			setResults(page.items);
			setActiveIndex(0);
		},
		[registry, maxResults],
	);

	// Re-run the *current* query when the registry mutates, via an Effect
	// Event so the subscription is not torn down and rebuilt on every parent
	// render — it reads the latest query + refresh without being a dependency.
	const onRegistryChange = React.useEffectEvent(() => {
		refresh(query);
	});

	// Focus the input when the palette opens. The query is cleared on close
	// (emitOpenChange) instead of being reset here, so this effect never
	// adjusts state purely because the `open` prop changed.
	React.useEffect(() => {
		if (!open) return;
		queueMicrotask(() => {
			inputRef.current?.focus();
		});
	}, [open]);

	// Single close path so the query resets on dismiss/select without a
	// prop-reactive effect — reopening always starts from an empty search.
	function emitOpenChange(nextOpen: boolean) {
		if (!nextOpen) {
			setQuery("");
		}
		onOpenChange(nextOpen);
	}

	// Re-run the search synchronously whenever the query changes.
	React.useEffect(() => {
		if (!open) return;
		refresh(query);
	}, [open, query, refresh]);

	// Subscribe to registry mutations once per open session — not per
	// keystroke.
	React.useEffect(() => {
		if (!open) return;
		return registry.subscribe(onRegistryChange);
	}, [open, registry]);

	function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
		if (event.key === "ArrowDown") {
			event.preventDefault();
			setActiveIndex((current) =>
				results.length === 0 ? 0 : Math.min(current + 1, results.length - 1),
			);
			return;
		}
		if (event.key === "ArrowUp") {
			event.preventDefault();
			setActiveIndex((current) => Math.max(current - 1, 0));
			return;
		}
		if (event.key === "Enter") {
			event.preventDefault();
			const picked = results[activeIndex];
			if (picked !== undefined) {
				onSelect(picked);
				emitOpenChange(false);
			}
		}
	}

	return (
		<Dialog open={open} onOpenChange={emitOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{msg("assetManager.palette.title")}</DialogTitle>
					<DialogDescription>
						{msg("assetManager.palette.subtitle")}
					</DialogDescription>
				</DialogHeader>
				<Input
					aria-label={msg("assetManager.palette.searchLabel")}
					onChange={(event) => {
						setQuery(event.target.value);
					}}
					onKeyDown={handleKeyDown}
					placeholder={msg("assetManager.palette.searchPlaceholder")}
					ref={inputRef}
					value={query}
				/>
				<ul
					aria-label={msg("assetManager.palette.resultsLabel")}
					data-asset-manager-palette-results
					ref={listRef}
					role="listbox"
				>
					{results.length === 0 ? (
						<li role="presentation">{msg("assetManager.palette.noMatches")}</li>
					) : (
						results.map((asset, index) => (
							<li
								aria-selected={index === activeIndex}
								key={asset.id}
								role="option"
							>
								<button
									aria-label={msg("assetManager.browser.insert").replace(
										"{id}",
										asset.id,
									)}
									data-active={index === activeIndex ? "true" : undefined}
									onClick={() => {
										onSelect(asset);
										emitOpenChange(false);
									}}
									onMouseEnter={() => {
										setActiveIndex(index);
									}}
									type="button"
								>
									<span>{asset.name ?? asset.id}</span>
									<span>{asset.meta?.mimeType ?? inferAssetKind(asset)}</span>
								</button>
							</li>
						))
					)}
				</ul>
			</DialogContent>
		</Dialog>
	);
}
