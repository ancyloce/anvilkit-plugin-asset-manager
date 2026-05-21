"use client";

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

export function AssetCommandPalette({
	registry,
	open,
	onOpenChange,
	onSelect,
	maxResults = DEFAULT_MAX_RESULTS,
}: AssetCommandPaletteProps) {
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

	// Mirror the live query into a ref so the registry subscription can
	// read it without being a dependency (which would resubscribe on
	// every keystroke).
	const queryRef = React.useRef(query);
	queryRef.current = query;

	// Reset the query and focus the input when the palette opens.
	React.useEffect(() => {
		if (!open) return;
		setQuery("");
		queueMicrotask(() => {
			inputRef.current?.focus();
		});
	}, [open]);

	// Re-run the search synchronously whenever the query changes.
	React.useEffect(() => {
		if (!open) return;
		refresh(query);
	}, [open, query, refresh]);

	// Subscribe to registry mutations once per open session — not per
	// keystroke — re-running the *current* query via the ref.
	React.useEffect(() => {
		if (!open) return;
		const unsubscribe = registry.subscribe(() => {
			refresh(queryRef.current);
		});
		return unsubscribe;
	}, [open, registry, refresh]);

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
				onOpenChange(false);
			}
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Find an asset</DialogTitle>
					<DialogDescription>
						Search by name, id, MIME type, or tag.
					</DialogDescription>
				</DialogHeader>
				<Input
					aria-label="Asset search query"
					onChange={(event) => {
						setQuery(event.target.value);
					}}
					onKeyDown={handleKeyDown}
					placeholder="Type to search…"
					ref={inputRef}
					value={query}
				/>
				<ul
					aria-label="Asset results"
					data-asset-manager-palette-results
					ref={listRef}
					role="listbox"
				>
					{results.length === 0 ? (
						<li role="presentation">No matches.</li>
					) : (
						results.map((asset, index) => (
							<li
								aria-selected={index === activeIndex}
								key={asset.id}
								role="option"
							>
								<button
									aria-label={`Insert asset ${asset.id}`}
									data-active={index === activeIndex ? "true" : undefined}
									onClick={() => {
										onSelect(asset);
										onOpenChange(false);
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
