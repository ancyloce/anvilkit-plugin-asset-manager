/**
 * @file Unsplash `AssetSourceProvider` (PRD 0002 §8). Lazy entry point reached
 * only via `import()` from the factory — never in the headless chunk. Public
 * subpath: `@anvilkit/plugin-asset-manager/providers/unsplash`.
 *
 * Compliance baked in: search returns hotlinked `urls.regular` + full
 * attribution metadata; `pickResult` fires the MANDATORY download trigger and
 * can optionally route the image bytes through the plugin's ingest pipeline.
 */

import type { StudioAsset } from "@anvilkit/core/types";

import type { AssetFilter, AssetListPage } from "../../types/filter.js";
import type { UploadResult } from "../../types/types.js";
import type { UnsplashSourceOptions } from "../../types/unsplash.js";
import { AssetSourceError } from "../../utils/errors.js";
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

/**
 * Upper bound on retained photo descriptors. ~21 pages at the 24/page default —
 * far beyond any realistic browse-before-pick session — while keeping the cache
 * from growing without limit across a long session of distinct queries.
 */
const BYID_MAX_ENTRIES = 512;

/** Binary ingest callback used when {@link UnsplashSourceOptions.rehostOnPick} is enabled. */
export type UnsplashRehostIngest = (
	file: File,
	options?: { readonly signal?: AbortSignal },
) => Promise<UploadResult>;

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

/** Create the Unsplash-backed read-only asset source provider. */
export function createUnsplashProvider(
	options: UnsplashSourceOptions,
	ingest?: UnsplashRehostIngest,
): AssetSourceProvider {
	const client = createUnsplashClient({
		...(options.proxyEndpoint !== undefined
			? { proxyEndpoint: options.proxyEndpoint }
			: {}),
		...(options.accessKey !== undefined
			? { accessKey: options.accessKey }
			: {}),
		...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
		// Forward only a sane positive timeout; a stray 0/NaN would make every
		// request abort instantly, so fall back to the client default instead.
		...(typeof options.requestTimeoutMs === "number" &&
		Number.isFinite(options.requestTimeoutMs) &&
		options.requestTimeoutMs > 0
			? { timeoutMs: options.requestTimeoutMs }
			: {}),
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
	// + return the hotlinked result without a refetch. Bounded LRU+TTL (it shares
	// the result cache's TTL) so a long session of distinct queries can't grow it
	// without limit; a miss is safe — pickResult refetches the photo and STILL
	// fires the mandatory download trigger.
	const byId = createTtlCache<UploadResult>(
		options.cacheTtlMs ?? 300_000,
		BYID_MAX_ENTRIES,
	);
	const trackDownload = (
		downloadLocation: string,
		signal?: AbortSignal,
	): void => {
		void client.trackDownload(downloadLocation, signal).catch((error) => {
			if (signal?.aborted) return;
			console.warn("asset-manager: Unsplash download tracking failed.", error);
		});
	};
	const fetchImpl = options.fetch ?? globalThis.fetch;

	const toUploadResult = (photo: UnsplashPhoto): UploadResult =>
		Object.freeze({
			id: `unsplash:${photo.id}`,
			url: photo.urls.regular, // browse hotlink; optionally rehosted on pick
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
		const seenAt = Date.now();
		for (const item of items) byId.set(item.id, item, seenAt);
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
		throwIfAborted(signal);
		let result = byId.get(asset.id, Date.now());
		if (result?.meta?.attribution === undefined) {
			// Cache miss (e.g. the provider was recreated since the search). The
			// photo id is embedded in `asset.id`, so refetch it before tracking or
			// rehosting. Rehosting cannot safely fall back to the bare asset because
			// that URL may itself be an unresolved `asset://` reference.
			const photoId = unsplashPhotoId(asset.id);
			try {
				result = toUploadResult(await client.getPhoto(photoId, signal));
				byId.set(result.id, result, Date.now());
			} catch (error) {
				if (
					signal?.aborted ||
					isAbortError(error) ||
					options.rehostOnPick === true
				) {
					throw error;
				}
				// Default hotlink mode preserves its existing best-effort cache-miss
				// fallback rather than fabricating attribution or a download trigger.
				return { id: asset.id, url: asset.url };
			}
		}

		const attribution = result.meta?.attribution;
		if (attribution !== undefined) {
			// Mandatory trigger, fire-and-forget so tracking failures do not block
			// insertion; client errors are reported by `trackDownload` above.
			trackDownload(attribution.downloadLocation, signal);
		}
		if (options.rehostOnPick !== true) return result;
		if (ingest === undefined) {
			throw new AssetSourceError(
				"ASSET_MUTATION_REJECTED",
				"Unsplash rehostOnPick requires an asset ingest pipeline.",
			);
		}

		const file = await downloadForRehost(
			fetchImpl,
			result,
			unsplashPhotoId(asset.id),
			signal,
		);
		throwIfAborted(signal);
		const hosted = await ingest(file, signal ? { signal } : undefined);
		throwIfAborted(signal);
		return {
			...hosted,
			...(result.name !== undefined ? { name: result.name } : {}),
			meta: {
				...(result.meta ?? {}),
				...(hosted.meta ?? {}),
				...(attribution !== undefined ? { attribution } : {}),
			},
		};
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
			connectSrc: [
				"https://api.unsplash.com",
				...(options.rehostOnPick === true
					? ["https://images.unsplash.com"]
					: []),
			],
			imgSrc: ["https://images.unsplash.com"],
		}),
		listThemes,
		search,
		pickResult,
	};
}

async function downloadForRehost(
	fetchImpl: typeof globalThis.fetch,
	result: UploadResult,
	photoId: string,
	signal?: AbortSignal,
): Promise<File> {
	throwIfAborted(signal);
	let response: Response;
	try {
		response = await fetchImpl(result.url, signal ? { signal } : undefined);
	} catch (error) {
		if (signal?.aborted || isAbortError(error)) throw error;
		throw new AssetSourceError(
			"PROVIDER_NETWORK",
			"Could not download the selected Unsplash image for rehosting.",
			{ cause: error, retryable: true },
		);
	}
	if (!response.ok) {
		throw new AssetSourceError(
			"PROVIDER_BAD_RESPONSE",
			`Unsplash image download returned HTTP ${response.status}.`,
			{ status: response.status, retryable: response.status >= 500 },
		);
	}

	let blob: Blob;
	try {
		blob = await response.blob();
	} catch (error) {
		if (signal?.aborted || isAbortError(error)) throw error;
		throw new AssetSourceError(
			"PROVIDER_BAD_RESPONSE",
			"Unsplash image download returned an unreadable body.",
			{ cause: error },
		);
	}
	throwIfAborted(signal);
	const mimeType =
		response.headers.get("content-type")?.split(";", 1)[0]?.trim() ||
		blob.type ||
		result.meta?.mimeType ||
		"image/jpeg";
	if (!mimeType.toLowerCase().startsWith("image/")) {
		throw new AssetSourceError(
			"PROVIDER_BAD_RESPONSE",
			`Unsplash image download returned non-image content (${mimeType}).`,
		);
	}
	return new File([blob], `unsplash-${photoId}.${fileExtension(mimeType)}`, {
		type: mimeType,
	});
}

function unsplashPhotoId(assetId: string): string {
	return assetId.startsWith("unsplash:")
		? assetId.slice("unsplash:".length)
		: assetId;
}

function fileExtension(mimeType: string): string {
	switch (mimeType.toLowerCase()) {
		case "image/png":
			return "png";
		case "image/webp":
			return "webp";
		case "image/avif":
			return "avif";
		default:
			return "jpg";
	}
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason instanceof Error) throw signal.reason;
	if (typeof DOMException !== "undefined") {
		throw new DOMException("Aborted", "AbortError");
	}
	const error = new Error("Aborted");
	error.name = "AbortError";
	throw error;
}

function isAbortError(error: unknown): boolean {
	return (
		error !== null &&
		typeof error === "object" &&
		(error as { readonly name?: unknown }).name === "AbortError"
	);
}
