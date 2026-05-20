/**
 * @file Test fixtures for downstream plugin authors building on
 * `@anvilkit/plugin-asset-manager`.
 *
 * For Studio plugin context fakes, use
 * `@anvilkit/core/testing.createFakeStudioContext` — these helpers focus
 * on the registry + uploader contracts owned by this package.
 */

import { createAssetRegistry } from "../registry.js";
import type {
  AssetMeta,
  AssetRegistry,
  UploadAdapter,
  UploadResult,
} from "../types.js";

export interface CreateTestRegistryOptions {
  readonly initial?: readonly UploadResult[];
}

export function createTestRegistry(
  options: CreateTestRegistryOptions = {},
): AssetRegistry {
  const registry = createAssetRegistry();
  for (const entry of options.initial ?? []) {
    registry.register(entry);
  }
  return registry;
}

export interface FakeUploaderOptions {
  /**
   * Optional map keyed by `File.name`. When a file is uploaded whose
   * name appears in the map, the corresponding `UploadResult` is
   * returned verbatim. Otherwise a deterministic synthetic result is
   * returned (`asset-{name}`, `https://test.local/{name}`).
   */
  readonly responses?: Record<string, UploadResult>;
}

export function fakeUploader(options: FakeUploaderOptions = {}): UploadAdapter {
  const responses = options.responses ?? {};
  return async (file) => {
    const canned = responses[file.name];
    if (canned !== undefined) {
      return canned;
    }
    const meta: AssetMeta = {
      size: file.size,
      ...(file.type ? { mimeType: file.type } : {}),
    };
    return {
      id: `asset-${slug(file.name)}`,
      url: `https://test.local/${encodeURIComponent(file.name)}`,
      name: file.name,
      meta,
    };
  };
}

function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}
