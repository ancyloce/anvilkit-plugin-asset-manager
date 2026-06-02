import { describe, expect, it } from "vitest";

import { createAssetManagerPlugin, inMemoryUploader } from "../index.js";

describe("AssetManagerOptions widening (backward compatibility)", () => {
	it("accepts NO arguments at all — true zero-config (param defaults to {})", () => {
		const plugin = createAssetManagerPlugin();
		expect(plugin.meta).toBeDefined();
		expect(typeof plugin.register).toBe("function");
	});

	it("accepts an empty options object — uploader is now optional (resolves the in-memory default)", () => {
		const plugin = createAssetManagerPlugin({});
		expect(plugin.meta).toBeDefined();
		expect(typeof plugin.register).toBe("function");
	});

	it("still accepts the explicit { uploader } form unchanged", () => {
		const plugin = createAssetManagerPlugin({ uploader: inMemoryUploader() });
		expect(plugin.meta).toBeDefined();
		expect(typeof plugin.register).toBe("function");
	});
});
