/**
 * @file Standalone `assetManager` i18n provider + the `AnvilkitMessages`
 * type augmentation.
 *
 * {@link AssetManagerI18nProvider} wraps the standalone `./ui` subpath
 * (mounted outside `<Studio>`) so its `useMsg("assetManager.*")` calls
 * resolve. Standalone mounts default to English; locale switching is a
 * Studio (in-chrome) feature. In-chrome usage needs no wrapper —
 * `register()` already contributes {@link ASSET_MANAGER_ENTRY}.
 */

import { EditorI18nProvider } from "@anvilkit/core/i18n";
import type { ReactNode } from "react";
// Classic-JSX build (React.createElement) — every .tsx must bind React or
// dist throws "React is not defined" at runtime (typecheck won't catch it).
import * as React from "react";

import { ASSET_MANAGER_ENTRY, type AssetManagerMessageKey } from "./entry.js";

/** Provide asset-manager i18n messages for standalone UI subpath mounts. */
export function AssetManagerI18nProvider({
	children,
}: {
	readonly children: ReactNode;
}): ReactNode {
	return (
		<EditorI18nProvider entries={[ASSET_MANAGER_ENTRY]}>
			{children}
		</EditorI18nProvider>
	);
}

// Augment the public key registry so `useT("assetManager.*")` autocompletes.
declare module "@anvilkit/core/i18n" {
	interface AnvilkitMessages extends Record<AssetManagerMessageKey, string> {}
}
