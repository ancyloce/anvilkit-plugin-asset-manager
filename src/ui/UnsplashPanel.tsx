"use client";

import { useMsg } from "@anvilkit/core/i18n";
import { Button } from "@anvilkit/ui/button";
import { Input } from "@anvilkit/ui/input";
import * as React from "react";

import type { AssetTheme } from "../sources/provider.js";
import type { UploadResult } from "../types/types.js";

/** A browsed Unsplash result + the attribution the tile must show. */
export interface UnsplashResult {
	readonly id: string;
	readonly thumbnailUrl: string;
	readonly photographerName: string;
	readonly photographerUrl: string;
	readonly unsplashUrl: string;
}

export type UnsplashPanelStatus =
	| "idle"
	| "loading"
	| "rateLimited"
	| "error"
	| "disabled";

export interface UnsplashPanelProps {
	readonly themes: readonly AssetTheme[];
	readonly activeThemeId?: string;
	readonly onThemeChange: (themeId: string | undefined) => void;
	readonly query: string;
	readonly onQueryChange: (query: string) => void;
	readonly results: readonly UnsplashResult[];
	readonly status: UnsplashPanelStatus;
	/** Insert a result — the host calls the provider's pickResult (download trigger). */
	readonly onPick: (id: string) => void | Promise<void>;
	readonly onLoadMore?: () => void;
	/** Map a theme label key → display text (defaults to the raw key). */
	readonly themeLabel?: (key: string) => string;
	/** Skeleton tile count while loading the first page. */
	readonly skeletonCount?: number;
}

export function UnsplashPanel({
	themes,
	activeThemeId,
	onThemeChange,
	query,
	onQueryChange,
	results,
	status,
	onPick,
	onLoadMore,
	themeLabel,
	skeletonCount = 12,
}: UnsplashPanelProps) {
	const msg = useMsg();
	// Host-provided theme resolver wins; otherwise resolve the theme key
	// (`assetManager.unsplash.theme.*`) against the catalog.
	const resolvedThemeLabel = themeLabel ?? ((key: string) => msg(key));
	if (status === "disabled") {
		return (
			<div
				role="status"
				data-testid="ak-unsplash-disabled"
				className="flex flex-col items-center gap-2 p-6 text-center text-sm text-[var(--ak-studio-muted-fg)]"
			>
				<p>{msg("assetManager.unsplash.disabled")}</p>
			</div>
		);
	}

	return (
		<div data-testid="ak-unsplash-panel" className="flex flex-col gap-2">
			{/* Visually-hidden live region so screen readers hear loading the same
			    way they hear the error / rate-limit alerts below. */}
			<span
				role="status"
				aria-live="polite"
				data-testid="ak-unsplash-status"
				className="sr-only"
			>
				{status === "loading" ? msg("assetManager.unsplash.loading") : ""}
			</span>
			<Input
				value={query}
				placeholder={msg("assetManager.unsplash.searchPlaceholder")}
				data-testid="ak-unsplash-search"
				onChange={(event) => onQueryChange(event.currentTarget.value)}
			/>
			{themes.length > 0 ? (
				<div
					role="group"
					aria-label={msg("assetManager.unsplash.themesLabel")}
					data-testid="ak-unsplash-themes"
					className="flex flex-wrap gap-1"
				>
					{themes.map((theme) => (
						<Button
							key={theme.id}
							type="button"
							size="sm"
							variant={theme.id === activeThemeId ? "secondary" : "ghost"}
							aria-pressed={theme.id === activeThemeId}
							data-theme-id={theme.id}
							onClick={() =>
								onThemeChange(theme.id === activeThemeId ? undefined : theme.id)
							}
						>
							{resolvedThemeLabel(theme.label)}
						</Button>
					))}
				</div>
			) : null}

			{status === "rateLimited" ? (
				<p
					role="alert"
					data-testid="ak-unsplash-rate-limited"
					className="text-sm"
				>
					{msg("assetManager.unsplash.rateLimited")}
				</p>
			) : null}
			{status === "error" ? (
				<p role="alert" data-testid="ak-unsplash-error" className="text-sm">
					{msg("assetManager.unsplash.error")}
				</p>
			) : null}

			{status === "loading" && results.length === 0 ? (
				<ul
					data-testid="ak-unsplash-skeletons"
					className="grid grid-cols-3 gap-2"
					aria-hidden="true"
				>
					{Array.from({ length: skeletonCount }, (_, index) => (
						<li
							key={`skeleton-${index}`}
							className="aspect-square animate-pulse rounded bg-[var(--ak-studio-muted,#e5e7eb)]"
						/>
					))}
				</ul>
			) : results.length === 0 && status === "idle" ? (
				<p data-testid="ak-unsplash-empty" className="p-4 text-center text-sm">
					{msg("assetManager.unsplash.empty")}
				</p>
			) : (
				<ul
					data-testid="ak-unsplash-results"
					className="grid grid-cols-3 gap-2"
				>
					{results.map((result) => (
						<li key={result.id} className="flex flex-col gap-0.5">
							<button
								type="button"
								data-unsplash-id={result.id}
								aria-label={msg("assetManager.unsplash.insert").replace(
									"{photographer}",
									result.photographerName,
								)}
								className="overflow-hidden rounded"
								onClick={() => void onPick(result.id)}
							>
								{/* Decorative: the wrapping button already carries the
								    "Insert photo by <name>" accessible name, so an alt
								    here would double-announce. */}
								<img
									src={result.thumbnailUrl}
									alt=""
									className="aspect-square w-full object-cover"
									loading="lazy"
								/>
							</button>
							<p className="truncate text-[10px] text-[var(--ak-studio-muted-fg)]">
								<a
									href={result.photographerUrl}
									target="_blank"
									rel="noreferrer noopener"
									className="underline"
								>
									{result.photographerName}
								</a>{" "}
								·{" "}
								<a
									href={result.unsplashUrl}
									target="_blank"
									rel="noreferrer noopener"
									className="underline"
								>
									Unsplash
								</a>
							</p>
						</li>
					))}
				</ul>
			)}

			{onLoadMore && results.length > 0 ? (
				<div className="flex justify-center">
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={status === "loading"}
						onClick={onLoadMore}
					>
						{msg("assetManager.button.loadMore")}
					</Button>
				</div>
			) : null}
		</div>
	);
}
