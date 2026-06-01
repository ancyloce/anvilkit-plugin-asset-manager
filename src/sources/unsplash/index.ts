/**
 * @file Unsplash `AssetSourceProvider` (PRD 0002 §8). Lazy entry point reached
 * only via `import()` from the factory — never in the headless chunk. Public
 * subpath: `@anvilkit/plugin-asset-manager/providers/unsplash`.
 *
 * Compliance baked in: search returns hotlinked `urls.regular` + full
 * attribution metadata; `pickResult` fires the MANDATORY download trigger.
 */

import type { StudioAsset } from "@anvilkit/core/types";

import type { AssetFilter, AssetListPage } from "../../types/filter.js";
import type { UploadResult } from "../../types/types.js";
import type { UnsplashSourceOptions } from "../../types/unsplash.js";
import type { AssetSourceProvider, AssetTheme } from "../provider.js";
import { createUnsplashClient, type UnsplashPhoto } from "./client.js";
import {
	ALL_THEME_ID,
	resolveDefaultThemeId,
	resolveThemes,
} from "./themes.js";
import {
	createSingleFlightThrottle,
	createTtlCache,
} from "./throttle-cache.js";

/** The facet key the UI uses to carry the active theme into a query. */
export const UNSPLASH_THEME_FACET = "unsplash:theme";

/** Enabled when a proxy endpoint or access key is present (or forced via `enabled`). */
export function unsplashEnabled(options: UnsplashSourceOptions): boolean {
	return (
		options.enabled ??
		(options.proxyEndpoint !== undefined || options.accessKey !== undefined)
	);
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

export function createUnsplashProvider(
	options: UnsplashSourceOptions,
): AssetSourceProvider {
	const client = createUnsplashClient({
		...(options.proxyEndpoint !== undefined
			? { proxyEndpoint: options.proxyEndpoint }
			: {}),
		...(options.accessKey !== undefined
			? { accessKey: options.accessKey }
			: {}),
		...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
	});
	const utm = `utm_source=${encodeURIComponent(options.appName)}&utm_medium=referral`;
	const themes = resolveThemes(options.themes);
	const defaultThemeId = resolveDefaultThemeId(themes, options.themes);
	const perPage = clamp(Math.trunc(options.perPage ?? 24), 1, 30);
	const cache = createTtlCache<AssetListPage>(options.cacheTtlMs ?? 300_000);
	const throttle = createSingleFlightThrottle({
		minIntervalMs: options.minRequestIntervalMs ?? 1200,
	});
	// Descriptors captured on search so pickResult can fire the download trigger
	// + return the hotlinked result without a refetch.
	const byId = new Map<string, UploadResult>();

	const toUploadResult = (photo: UnsplashPhoto): UploadResult =>
		Object.freeze({
			id: `unsplash:${photo.id}`,
			url: photo.urls.regular, // hotlink — never re-hosted
			name:
				photo.description?.trim() ||
				photo.alt_description?.trim() ||
				`Unsplash ${photo.id}`,
			meta: {
				...(photo.width !== undefined ? { width: photo.width } : {}),
				...(photo.height !== undefined ? { height: photo.height } : {}),
				mimeType: "image/jpeg",
				attribution: {
					source: "unsplash" as const,
					photographerName: photo.user.name,
					photographerUrl: `${photo.user.links.html}?${utm}`,
					unsplashUrl: `https://unsplash.com/?${utm}`,
					photoUrl: photo.links.html,
					downloadLocation: photo.links.download_location,
				},
			},
		});

	const findTheme = (id: string | undefined) =>
		themes.find((theme) => theme.id === id);

	const search = async (
		filter: AssetFilter,
		page: string | undefined,
		signal?: AbortSignal,
	): Promise<AssetListPage> => {
		const pageNum = page !== undefined ? Math.max(1, Number(page) || 1) : 1;
		const themeId =
			filter.facets?.[UNSPLASH_THEME_FACET]?.[0] ?? defaultThemeId;
		const theme = findTheme(themeId);
		const freeText = filter.query?.trim() ?? "";
		const cacheKey = `${themeId ?? ""}|${freeText}|${pageNum}`;

		const hit = cache.get(cacheKey, Date.now());
		if (hit !== undefined) return hit;

		let photos: readonly UnsplashPhoto[];
		let total: number;
		if (
			theme?.topicSlugs &&
			theme.topicSlugs.length > 0 &&
			freeText === "" &&
			themeId !== ALL_THEME_ID
		) {
			const slug = theme.topicSlugs[0] ?? "";
			photos = await throttle.run(() =>
				client.topicPhotos(
					slug,
					{
						page: pageNum,
						perPage,
						...(theme.orientation ? { orientation: theme.orientation } : {}),
					},
					signal,
				),
			);
			total = photos.length; // topic endpoint exposes no grand total
		} else {
			const query =
				[theme?.query, freeText]
					.filter((part): part is string => Boolean(part))
					.join(" ") || "editorial";
			const result = await throttle.run(() =>
				client.searchPhotos(
					{
						query,
						page: pageNum,
						perPage,
						contentFilter: theme?.contentFilter ?? "high",
						...(theme?.orientation ? { orientation: theme.orientation } : {}),
					},
					signal,
				),
			);
			photos = result.results;
			total = result.total;
		}

		const items = photos.map(toUploadResult);
		for (const item of items) byId.set(item.id, item);
		const listPage: AssetListPage = {
			items,
			total,
			nextCursor: photos.length >= perPage ? String(pageNum + 1) : undefined,
		};
		cache.set(cacheKey, listPage, Date.now());
		return listPage;
	};

	const pickResult = async (
		asset: StudioAsset,
		signal?: AbortSignal,
	): Promise<UploadResult> => {
		const cached = byId.get(asset.id);
		if (cached?.meta?.attribution !== undefined) {
			// Mandatory trigger, fire-and-forget so it never blocks insert.
			void client.trackDownload(
				cached.meta.attribution.downloadLocation,
				signal,
			);
			return cached;
		}
		// Cache miss (e.g. the provider was recreated since the search). The photo
		// id is embedded in `asset.id`, so refetch the photo and STILL fire the
		// mandatory download trigger — Unsplash compliance must never be skipped.
		const photoId = asset.id.startsWith("unsplash:")
			? asset.id.slice("unsplash:".length)
			: asset.id;
		try {
			const result = toUploadResult(await client.getPhoto(photoId, signal));
			byId.set(result.id, result);
			if (result.meta?.attribution !== undefined) {
				void client.trackDownload(
					result.meta.attribution.downloadLocation,
					signal,
				);
			}
			return result;
		} catch {
			// Could not recover the photo — return the bare reference rather than
			// fabricate a (non-compliant) trigger for a download_location we lack.
			return { id: asset.id, url: asset.url };
		}
	};

	const listThemes = (): readonly AssetTheme[] => themes;

	return {
		id: "unsplash",
		label: "assetManager.source.unsplash",
		capabilities: {
			searchable: true,
			themed: true,
			mutable: false,
			requiresAttribution: true,
			folders: false,
		},
		requiredCsp: () => ({
			connectSrc: ["https://api.unsplash.com"],
			imgSrc: ["https://images.unsplash.com"],
		}),
		listThemes,
		search,
		pickResult,
	};
}
