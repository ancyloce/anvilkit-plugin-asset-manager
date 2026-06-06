/**
 * @file The `assetManager` registry entry (pure data — no React).
 *
 * Message content lives in `messages/<locale>.json`; English ships inline
 * and other locales lazy-load. Kept separate from `provider.tsx` so the
 * headless `register()` can import {@link ASSET_MANAGER_ENTRY} without
 * pulling the React `EditorI18nProvider` into the headless entry chunk.
 */

import type { RegistryEntry } from "@anvilkit/core/i18n";

// Messages live at the plugin-root `i18n/messages/` (shipped via the
// package `files`). Imported from outside `src/` so the bundleless rslib
// build keeps them external `.json` (an in-`src` import is rewritten to
// `.js` and not emitted) — same pattern as `meta/config.json`.
import enMessages from "../../i18n/messages/en.json" with { type: "json" };

/** Static lazy-pack map (avoids a dynamic template `import()` under rslib). */
const LOCALE_PACKS: Readonly<
	Record<string, () => Promise<{ readonly default: Record<string, string> }>>
> = {
	zh: () => import("../../i18n/messages/zh.json", { with: { type: "json" } }),
};

/** The registry entry contributed to the catalog (core prepends `studio.*`). */
export const ASSET_MANAGER_ENTRY: RegistryEntry = {
	namespace: "assetManager",
	en: enMessages,
	loadMessages: async (locale) => {
		const pack = LOCALE_PACKS[locale];
		return pack === undefined ? {} : (await pack()).default;
	},
};

/** Exact key union for the `AnvilkitMessages` augmentation. */
export type AssetManagerMessageKey = keyof typeof enMessages;
