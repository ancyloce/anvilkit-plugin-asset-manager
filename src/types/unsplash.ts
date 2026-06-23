/**
 * @file Unsplash configuration types (PRD 0002 §8.2, §8.3).
 *
 * Types only — the runtime client, default themes, and `resolveThemes` land in
 * Phase 1 under the lazy `./sources/unsplash` subpath. Defining the config shape
 * here keeps the `AssetManagerOptions.unsplash` field fully typed now.
 */

export interface UnsplashTheme {
	readonly id: string;
	/** i18n message key (not inline copy). */
	readonly label: string;
	/** Tried first via `GET /topics/:id/photos`. */
	readonly topicSlugs?: readonly string[];
	/** Fallback / supplement via `GET /search/photos`. */
	readonly query?: string;
	readonly orientation?: "landscape" | "portrait" | "squarish";
	/** Defaults to `"high"`. */
	readonly contentFilter?: "low" | "high";
}

/** Theme configuration for the built-in Unsplash provider. */
export interface UnsplashThemeConfig {
	/** Replace the default theme set entirely. */
	readonly themes?: readonly UnsplashTheme[];
	/** Append to the defaults. */
	readonly additionalThemes?: readonly UnsplashTheme[];
	/** Theme ids to drop from the defaults. */
	readonly excludeThemes?: readonly string[];
	readonly defaultThemeId?: string;
	/** When `false`, the `__all__` free-search pseudo-theme is not prepended. */
	readonly allowFreeSearch?: boolean;
}

/** Options for enabling and configuring the Unsplash source provider. */
export interface UnsplashSourceOptions {
	/** RECOMMENDED — proxy injects the `Client-ID` server-side. */
	readonly proxyEndpoint?: string | URL;
	/** DEV ONLY — ships the key to the browser; ignored when `proxyEndpoint` is set. */
	readonly accessKey?: string;
	/** Defaults to `!!(proxyEndpoint || accessKey)`; the package never bundles a key. */
	readonly enabled?: boolean;
	/** REQUIRED when enabled — `utm_source` for mandatory attribution. */
	readonly appName: string;
	readonly themes?: UnsplashThemeConfig;
	/** Default 24 (clamped 1–30). */
	readonly perPage?: number;
	/** Throttle floor between JSON requests. Default 1200. */
	readonly minRequestIntervalMs?: number;
	/** Result LRU TTL. Default 300_000. */
	readonly cacheTtlMs?: number;
	/**
	 * Per-request timeout for search / topic / photo lookups (ms). A request
	 * that exceeds it aborts and surfaces as a retryable `PROVIDER_NETWORK`
	 * error, so a blocked or flaky network path (e.g. a VPN/proxy black-holing
	 * `api.unsplash.com`) lets the sidebar fall back to "Unsplash unavailable"
	 * instead of spinning. Default 15_000. Ignored if not a positive number.
	 */
	readonly requestTimeoutMs?: number;
	/** Injectable fetch for tests / SSR. */
	readonly fetch?: typeof globalThis.fetch;
	/** Opt-in re-host instead of hotlinking. Default false. */
	readonly rehostOnPick?: boolean;
}
