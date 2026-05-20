import { describe, expect, it } from "vitest";

import { AssetResolutionError } from "../errors.js";
import { createAssetRegistry } from "../registry.js";
import { createIRAssetResolver } from "../resolver.js";

describe("AssetResolutionError", () => {
  it("defaults code to ASSET_NOT_FOUND when only assetId is provided", () => {
    const error = new AssetResolutionError("asset-x");
    expect(error.assetId).toBe("asset-x");
    expect(error.code).toBe("ASSET_NOT_FOUND");
    expect(error.name).toBe("AssetResolutionError");
    expect(error.message).toContain("asset-x");
  });

  it("accepts an explicit code and custom message", () => {
    const error = new AssetResolutionError(
      "asset-y",
      "ASSET_URL_REJECTED",
      "hostile URL",
    );
    expect(error.code).toBe("ASSET_URL_REJECTED");
    expect(error.message).toBe("hostile URL");
  });

  it("threads the cause when supplied", () => {
    const cause = new Error("boom");
    const error = new AssetResolutionError(
      "asset-z",
      "ASSET_VALIDATION_FAILED",
      undefined,
      { cause },
    );
    expect(error.code).toBe("ASSET_VALIDATION_FAILED");
    expect(error.cause).toBe(cause);
  });
});

describe("createIRAssetResolver error codes", () => {
  it("throws ASSET_NOT_FOUND for unknown asset ids", () => {
    const resolver = createIRAssetResolver({ registry: createAssetRegistry() });
    try {
      resolver("asset://missing");
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AssetResolutionError);
      expect((error as AssetResolutionError).code).toBe("ASSET_NOT_FOUND");
      expect((error as AssetResolutionError).assetId).toBe("missing");
    }
  });

  it("throws ASSET_URL_REJECTED for disallowed schemes", () => {
    const registry = createAssetRegistry();
    registry.register({
      id: "asset-hostile",
      url: "javascript:alert(1)",
      meta: { mimeType: "image/png" },
    });
    const resolver = createIRAssetResolver({ registry });

    try {
      resolver("asset://asset-hostile");
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AssetResolutionError);
      expect((error as AssetResolutionError).code).toBe("ASSET_URL_REJECTED");
    }
  });

  it("throws ASSET_URL_REJECTED for empty stored URLs", () => {
    const registry = createAssetRegistry();
    registry.register({
      id: "asset-empty",
      url: "",
    });
    const resolver = createIRAssetResolver({ registry });

    try {
      resolver("asset://asset-empty");
      throw new Error("expected throw");
    } catch (error) {
      expect((error as AssetResolutionError).code).toBe("ASSET_URL_REJECTED");
    }
  });

  it("throws ASSET_URL_REJECTED when the URL scheme is not in the allowlist", () => {
    const registry = createAssetRegistry();
    registry.register({
      id: "asset-data",
      url: "data:image/png;base64,AAAA",
    });
    // Default allowlist excludes `data`.
    const resolver = createIRAssetResolver({ registry });

    try {
      resolver("asset://asset-data");
      throw new Error("expected throw");
    } catch (error) {
      expect((error as AssetResolutionError).code).toBe("ASSET_URL_REJECTED");
    }
  });

  it("threads the original validation error as cause", () => {
    const registry = createAssetRegistry();
    registry.register({
      id: "asset-hostile",
      url: "javascript:alert(1)",
    });
    const resolver = createIRAssetResolver({ registry });

    try {
      resolver("asset://asset-hostile");
      throw new Error("expected throw");
    } catch (error) {
      const cause = (error as AssetResolutionError).cause;
      expect(cause).toBeDefined();
      expect((cause as Error).name).toBe("AssetValidationError");
    }
  });
});
