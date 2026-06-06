import {
	type RenderOptions,
	render as rtlRender,
} from "@testing-library/react";
import * as React from "react";

import { AssetManagerI18nProvider } from "../../i18n/provider.js";

/**
 * Wraps every render in the plugin's own i18n provider so standalone `./ui`
 * components resolve `assetManager.*` message keys to their English baseline
 * — exactly as they do when mounted outside the Studio chrome in production.
 * Without it `useMsg()` falls back to the bare key (no catalog), and any
 * assertion on user-facing text fails.
 */
function Wrapper({ children }: { children: React.ReactNode }) {
	return <AssetManagerI18nProvider>{children}</AssetManagerI18nProvider>;
}

function render(
	ui: React.ReactElement,
	options?: Omit<RenderOptions, "wrapper">,
) {
	return rtlRender(ui, { wrapper: Wrapper, ...options });
}

// Re-export the rest of RTL; the explicit `render` below shadows RTL's.
export * from "@testing-library/react";
export { render };
