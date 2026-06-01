/**
 * @file Dependency-free Unsplash REST client (PRD 0002 §8.6). Uses only
 * `globalThis.fetch` — no `unsplash-js`, no new dependency or peer (which would
 * fail the repo's `check:peer-deps` gate). Lazy-loaded, so it never enters the
 * headless entry chunk.
 *
 * Base URL is the host's server-side proxy when supplied (which injects the
 * `Client-ID`), else `https://api.unsplash.com` with a `Client-ID` header.
 */

import { AssetSourceError } from "../../utils/errors.js";

export interface UnsplashClientOptions {
	readonly proxyEndpoint?: string | URL;
	readonly accessKey?: string;
	readonly fetch?: typeof globalThis.fetch;
}

export interface UnsplashPhotoUrls {
	readonly raw?: string;
	readonly full?: string;
	readonly regular: string;
	readonly small: string;
	readonly thumb: string;
}

export interface UnsplashPhoto {
	readonly id: string;
	readonly width?: number;
	readonly height?: number;
	readonly description?: string | null;
	readonly alt_description?: string | null;
	readonly urls: UnsplashPhotoUrls;
	readonly links: { readonly html: string; readonly download_location: string };
	readonly user: {
		readonly name: string;
		readonly links: { readonly html: string };
	};
}

export interface UnsplashSearchResult {
	readonly total: number;
	readonly results: readonly UnsplashPhoto[];
}

export interface UnsplashTopicSummary {
	readonly id: string;
	readonly slug: string;
	readonly title: string;
}

export interface UnsplashSearchParams {
	readonly query: string;
	readonly page?: number;
	readonly perPage?: number;
	readonly orientation?: string;
	readonly contentFilter?: string;
}

export interface UnsplashClient {
	searchPhotos(
		params: UnsplashSearchParams,
		signal?: AbortSignal,
	): Promise<UnsplashSearchResult>;
	topicPhotos(
		slug: string,
		params: { page?: number; perPage?: number; orientation?: string },
		signal?: AbortSignal,
	): Promise<readonly UnsplashPhoto[]>;
	listTopics(signal?: AbortSignal): Promise<readonly UnsplashTopicSummary[]>;
	/** Fetch a single photo by id — used to recover `download_location` on a cache miss. */
	getPhoto(id: string, signal?: AbortSignal): Promise<UnsplashPhoto>;
	/** Fires the MANDATORY download trigger. Non-throwing — best-effort. */
	trackDownload(downloadLocation: string, signal?: AbortSignal): Promise<void>;
}

function isAbortError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		(error as { name?: unknown }).name === "AbortError"
	);
}

function parseRetryAfterMs(headers: Headers): number | undefined {
	const retryAfter = headers.get("retry-after");
	if (retryAfter !== null) {
		const seconds = Number(retryAfter);
		if (Number.isFinite(seconds)) return seconds * 1000;
	}
	const reset = headers.get("x-ratelimit-reset");
	if (reset !== null) {
		const epochSeconds = Number(reset);
		if (Number.isFinite(epochSeconds)) {
			const ms = epochSeconds * 1000 - Date.now();
			if (ms > 0) return ms;
		}
	}
	return undefined;
}

function mapHttpError(response: Response): AssetSourceError {
	if (response.status === 429) {
		const retryAfterMs = parseRetryAfterMs(response.headers);
		return new AssetSourceError(
			"PROVIDER_RATE_LIMITED",
			"Unsplash rate limit reached.",
			{
				retryable: true,
				status: 429,
				...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
			},
		);
	}
	if (response.status === 401 || response.status === 403) {
		return new AssetSourceError(
			"PROVIDER_UNAUTHORIZED",
			"Unsplash rejected the request — check the access key / proxy.",
			{ status: response.status },
		);
	}
	return new AssetSourceError(
		"PROVIDER_BAD_RESPONSE",
		`Unsplash returned HTTP ${response.status}.`,
		{ status: response.status, retryable: response.status >= 500 },
	);
}

export function createUnsplashClient(
	options: UnsplashClientOptions,
): UnsplashClient {
	const doFetch = options.fetch ?? globalThis.fetch;
	const usingProxy = options.proxyEndpoint !== undefined;
	const base = (
		usingProxy ? String(options.proxyEndpoint) : "https://api.unsplash.com"
	).replace(/\/$/, "");

	const authHeaders = (): Record<string, string> =>
		!usingProxy && options.accessKey
			? { Authorization: `Client-ID ${options.accessKey}` }
			: {};

	const request = async (
		path: string,
		params: Record<string, string | number | undefined>,
		signal?: AbortSignal,
	): Promise<Response> => {
		// Build the query manually (not via `new URL`) so a RELATIVE proxy
		// endpoint like "/api/unsplash" works in the browser without a base.
		const search = new URLSearchParams();
		for (const [key, value] of Object.entries(params)) {
			if (value !== undefined) search.set(key, String(value));
		}
		const query = search.toString();
		const url = `${base}${path}${query ? `?${query}` : ""}`;
		let response: Response;
		try {
			response = await doFetch(url, {
				headers: authHeaders(),
				...(signal ? { signal } : {}),
			});
		} catch (cause) {
			if (isAbortError(cause)) throw cause;
			throw new AssetSourceError(
				"PROVIDER_NETWORK",
				"Network error contacting Unsplash.",
				{ retryable: true, cause },
			);
		}
		if (!response.ok) throw mapHttpError(response);
		return response;
	};

	const readJson = async <T>(response: Response): Promise<T> => {
		try {
			return (await response.json()) as T;
		} catch (cause) {
			throw new AssetSourceError(
				"PROVIDER_BAD_RESPONSE",
				"Unsplash returned an unreadable response.",
				{ cause },
			);
		}
	};

	return {
		async searchPhotos(params, signal) {
			const response = await request(
				"/search/photos",
				{
					query: params.query,
					page: params.page,
					per_page: params.perPage,
					orientation: params.orientation,
					content_filter: params.contentFilter,
				},
				signal,
			);
			const body = await readJson<{
				total?: number;
				results?: UnsplashPhoto[];
			}>(response);
			return { total: body.total ?? 0, results: body.results ?? [] };
		},

		async topicPhotos(slug, params, signal) {
			const response = await request(
				`/topics/${encodeURIComponent(slug)}/photos`,
				{
					page: params.page,
					per_page: params.perPage,
					orientation: params.orientation,
				},
				signal,
			);
			return (await readJson<UnsplashPhoto[]>(response)) ?? [];
		},

		async listTopics(signal) {
			const response = await request("/topics", { per_page: 30 }, signal);
			return (await readJson<UnsplashTopicSummary[]>(response)) ?? [];
		},

		async trackDownload(downloadLocation, signal) {
			// Mandatory on insert, but never blocks it: swallow all failures.
			try {
				await doFetch(downloadLocation, {
					headers: authHeaders(),
					...(signal ? { signal } : {}),
				});
			} catch {
				/* best-effort download trigger */
			}
		},
	};
}
