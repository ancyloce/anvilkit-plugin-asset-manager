import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";
import { inMemoryUploader } from "../adapters/in-memory.js";
import { createAssetManagerPlugin } from "../plugin.js";

/**
 * Metadata drift guard: `META.version` comes from the hand-maintained
 * `version.ts` constant (a `package.json` import would inline the whole
 * file and blow the gzip budget). This test ties that constant back to
 * package.json, so a Changesets bump that forgets `version.ts` fails
 * here rather than leaving the runtime metadata stale.
 */
describe("plugin metadata drift", () => {
	it("meta.version matches package.json version", () => {
		const plugin = createAssetManagerPlugin({
			uploader: inMemoryUploader(),
		});
		expect(plugin.meta.version).toBe(packageJson.version);
	});
});
