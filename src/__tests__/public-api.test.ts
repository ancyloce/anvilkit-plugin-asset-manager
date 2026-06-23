import { describe, expect, it } from "vitest";

import {
	ASSET_MANAGER_ERROR_EVENT,
	ASSET_MANAGER_UPLOADED_EVENT,
	createAssetReference,
	getAssetRegistry,
	uploadAsset,
} from "../index.js";

describe("public API", () => {
	it("exports the production headless upload helpers from the root entry", () => {
		expect(createAssetReference("asset-1")).toBe("asset://asset-1");
		expect(typeof getAssetRegistry).toBe("function");
		expect(typeof uploadAsset).toBe("function");
		expect(ASSET_MANAGER_UPLOADED_EVENT).toBe("asset-manager:uploaded");
		expect(ASSET_MANAGER_ERROR_EVENT).toBe("asset-manager:error");
	});
});
