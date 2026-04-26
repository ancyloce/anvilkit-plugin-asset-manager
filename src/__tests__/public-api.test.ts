import { describe, expect, it } from "vitest";

import {
	createAssetReference,
	getAssetRegistry,
	uploadAsset,
} from "../index.js";

describe("public API", () => {
	it("exports the production headless upload helpers from the root entry", () => {
		expect(createAssetReference("asset-1")).toBe("asset://asset-1");
		expect(typeof getAssetRegistry).toBe("function");
		expect(typeof uploadAsset).toBe("function");
	});
});
