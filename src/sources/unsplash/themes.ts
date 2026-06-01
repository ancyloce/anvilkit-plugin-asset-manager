/**
 * @file Default Unsplash theme set + resolution (PRD 0002 §8.2). A theme maps
 * to an Unsplash topic slug (tried first), a curated search query (fallback /
 * supplement), or both. Labels are i18n message keys, never inline copy.
 */

import type {
	UnsplashTheme,
	UnsplashThemeConfig,
} from "../../types/unsplash.js";

/** The free-search pseudo-theme prepended unless `allowFreeSearch === false`. */
export const ALL_THEME_ID = "__all__";

export const DEFAULT_UNSPLASH_THEMES: readonly UnsplashTheme[] = Object.freeze([
	{
		id: "nature",
		label: "assetManager.unsplash.theme.nature",
		topicSlugs: ["nature"],
		query: "nature landscape",
		orientation: "landscape",
	},
	{
		id: "architecture",
		label: "assetManager.unsplash.theme.architecture",
		topicSlugs: ["architecture-interior"],
		query: "architecture building",
	},
	{
		id: "business",
		label: "assetManager.unsplash.theme.business",
		topicSlugs: ["business-work"],
		query: "business office work",
	},
	{
		id: "food",
		label: "assetManager.unsplash.theme.food",
		topicSlugs: ["food-drink"],
		query: "food meal",
	},
	{
		id: "technology",
		label: "assetManager.unsplash.theme.technology",
		topicSlugs: ["experimental"],
		query: "technology computer",
	},
	{
		id: "travel",
		label: "assetManager.unsplash.theme.travel",
		topicSlugs: ["travel"],
		query: "travel destination",
	},
	{
		id: "texture",
		label: "assetManager.unsplash.theme.texture",
		topicSlugs: ["textures-patterns"],
		query: "abstract texture",
		orientation: "squarish",
	},
	{
		id: "people",
		label: "assetManager.unsplash.theme.people",
		topicSlugs: ["people"],
		query: "people portrait",
	},
]);

/**
 * Resolve the effective theme list: replace-all when `themes` is given, else
 * filter the defaults by `excludeThemes` and append `additionalThemes`. The
 * `__all__` free-search pseudo-theme is prepended unless disabled.
 */
export function resolveThemes(
	config?: UnsplashThemeConfig,
): readonly UnsplashTheme[] {
	let base: readonly UnsplashTheme[];
	if (config?.themes) {
		base = config.themes;
	} else {
		const excluded = new Set(config?.excludeThemes ?? []);
		const filtered =
			excluded.size > 0
				? DEFAULT_UNSPLASH_THEMES.filter((t) => !excluded.has(t.id))
				: DEFAULT_UNSPLASH_THEMES;
		base = config?.additionalThemes
			? [...filtered, ...config.additionalThemes]
			: filtered;
	}

	const themes: UnsplashTheme[] = [];
	if (config?.allowFreeSearch !== false) {
		themes.push({ id: ALL_THEME_ID, label: "assetManager.unsplash.theme.all" });
	}
	themes.push(...base);
	return Object.freeze(themes);
}

/** Pick the initial theme: the configured default if present, else the first. */
export function resolveDefaultThemeId(
	themes: readonly UnsplashTheme[],
	config?: UnsplashThemeConfig,
): string | undefined {
	if (
		config?.defaultThemeId &&
		themes.some((t) => t.id === config.defaultThemeId)
	) {
		return config.defaultThemeId;
	}
	return themes[0]?.id;
}
