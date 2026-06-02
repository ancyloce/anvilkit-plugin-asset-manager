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
	/**
	 * Per-request ceiling for search / topic / photo lookups (ms). A request
	 * that exceeds it aborts and surfaces as a retryable `PROVIDER_NETWORK`
	 * error instead of hanging on the platform's default socket timeout — so a
	 * blocked or flaky network path (e.g. a VPN/proxy black-holing
	 * `api.unsplash.com`) lets the sidebar fall back to a clean "unavailable"
	 * state. Default 15000. When the proxy route is used it has its own,
	 * tighter timeout + retry, so this is mainly a backstop for the direct path.
	 */
	readonly timeoutMs?: number;
	/**
	 * Ceiling for the best-effort, fire-and-forget download trigger (ms). It
	 * pings the absolute `download_location` URL DIRECTLY (never through the
	 * host proxy), so without a bound a stalled connection would leak a hanging
	 * request per insert. Default 6000.
	 */
	readonly trackDownloadTimeoutMs?: number;
}

interface TimedSignal {
	readonly signal: AbortSignal;
	/** True once our own timeout fired (vs. a caller-driven cancel). */
	timedOut(): boolean;
	/** Clear the timer + detach the caller listener once the call settles. */
	dispose(): void;
}

/**
 * Build an `AbortSignal` that aborts when EITHER our timeout elapses OR the
 * caller's `signal` fires. Hand-wired with `AbortController` + `setTimeout`
 * (rather than `AbortSignal.timeout`/`AbortSignal.any`) so it runs on every
 * browser/runtime regardless of those newer statics. The `timedOut` flag lets
 * the caller tell our timeout apart from a deliberate cancel.
 */
function createTimedSignal(
	timeoutMs: number,
	caller?: AbortSignal,
): TimedSignal {
	const controller = new AbortController();
	let didTimeout = false;
	const timer = setTimeout(() => {
		didTimeout = true;
		controller.abort();
	}, timeoutMs);
	// A pending best-effort fetch must never keep a Node process alive.
	(timer as { unref?: () => void }).unref?.();
	const onCallerAbort = (): void => controller.abort();
	if (caller) {
		if (caller.aborted) controller.abort();
		else caller.addEventListener("abort", onCallerAbort, { once: true });
	}
	return {
		signal: controller.signal,
		timedOut: () => didTimeout,
		dispose: () => {
			clearTimeout(timer);
			caller?.removeEventListener("abort", onCallerAbort);
		},
	};
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
	const timeoutMs = options.timeoutMs ?? 15_000;
	const trackDownloadTimeoutMs = options.trackDownloadTimeoutMs ?? 6_000;

	const authHeaders = (): Record<string, string> =>
		!usingProxy && options.accessKey
			? { Authorization: `Client-ID ${options.accessKey}` }
			: {};

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

	// Single timed fetch + JSON parse. The timeout signal stays live through the
	// body read, so both a stalled connect AND a stalled body abort under one
	// ceiling; `dispose()` clears it once the call settles either way.
	const requestJson = async <T>(
		path: string,
		params: Record<string, string | number | undefined>,
		signal?: AbortSignal,
	): Promise<T> => {
		// Build the query manually (not via `new URL`) so a RELATIVE proxy
		// endpoint like "/api/unsplash" works in the browser without a base.
		const search = new URLSearchParams();
		for (const [key, value] of Object.entries(params)) {
			if (value !== undefined) search.set(key, String(value));
		}
		const query = search.toString();
		const url = `${base}${path}${query ? `?${query}` : ""}`;
		const timed = createTimedSignal(timeoutMs, signal);
		try {
			let response: Response;
			try {
				response = await doFetch(url, {
					headers: authHeaders(),
					signal: timed.signal,
				});
			} catch (cause) {
				// Our own ceiling fired → retryable network error, not a bare abort,
				// so the UI shows "Unsplash unavailable" rather than silently
				// dropping the request like a caller-driven cancel.
				if (timed.timedOut()) {
					throw new AssetSourceError(
						"PROVIDER_NETWORK",
						`Unsplash request timed out after ${timeoutMs} ms.`,
						{ retryable: true, cause },
					);
				}
				// A deliberate caller cancel (unmount / source switch) propagates as
				// the abort it is — callers already ignore aborted requests.
				if (isAbortError(cause)) throw cause;
				throw new AssetSourceError(
					"PROVIDER_NETWORK",
					"Network error contacting Unsplash.",
					{ retryable: true, cause },
				);
			}
			if (!response.ok) throw mapHttpError(response);
			return await readJson<T>(response);
		} finally {
			timed.dispose();
		}
	};

	return {
		async searchPhotos(params, signal) {
			const body = await requestJson<{
				total?: number;
				results?: UnsplashPhoto[];
			}>(
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
			return { total: body.total ?? 0, results: body.results ?? [] };
		},

		async topicPhotos(slug, params, signal) {
			return (
				(await requestJson<UnsplashPhoto[]>(
					`/topics/${encodeURIComponent(slug)}/photos`,
					{
						page: params.page,
						per_page: params.perPage,
						orientation: params.orientation,
					},
					signal,
				)) ?? []
			);
		},

		async listTopics(signal) {
			return (
				(await requestJson<UnsplashTopicSummary[]>(
					"/topics",
					{ per_page: 30 },
					signal,
				)) ?? []
			);
		},

		async getPhoto(id, signal) {
			return requestJson<UnsplashPhoto>(
				`/photos/${encodeURIComponent(id)}`,
				{},
				signal,
			);
		},

		async trackDownload(downloadLocation, signal) {
			// Mandatory on insert, but never blocks it: swallow all failures and
			// bound the ping so a stalled tunnel can't leak a hanging request
			// (this fires the absolute URL directly — never via the host proxy).
			const timed = createTimedSignal(trackDownloadTimeoutMs, signal);
			try {
				await doFetch(downloadLocation, {
					headers: authHeaders(),
					signal: timed.signal,
				});
			} catch {
				/* best-effort download trigger */
			} finally {
				timed.dispose();
			}
		},
	};
}
