/**
 * @file Test fixtures for downstream plugin authors building on
 * `@anvilkit/plugin-asset-manager`.
 *
 * For Studio plugin context fakes, use
 * `@anvilkit/core/testing.createFakeStudioContext` — these helpers focus
 * on the registry + uploader contracts owned by this package.
 */

import type {
	AssetMeta,
	AssetRegistry,
	UploadAdapter,
	UploadResult,
} from "../types/types.js";
import { createAssetRegistry } from "../utils/registry.js";

/** Options for constructing a registry fixture in tests. */
export interface CreateTestRegistryOptions {
	readonly initial?: readonly UploadResult[];
}

/** Create an in-memory registry preloaded with optional upload rows. */
export function createTestRegistry(
	options: CreateTestRegistryOptions = {},
): AssetRegistry {
	const registry = createAssetRegistry();
	for (const entry of options.initial ?? []) {
		registry.register(entry);
	}
	return registry;
}

/** Options for the deterministic fake uploader helper. */
export interface FakeUploaderOptions {
	/**
	 * Optional map keyed by `File.name`. When a file is uploaded whose
	 * name appears in the map, the corresponding `UploadResult` is
	 * returned verbatim. Otherwise a deterministic synthetic result is
	 * returned (`asset-{name}`, `https://test.local/{name}`).
	 */
	readonly responses?: Record<string, UploadResult>;
}

/** Create a deterministic fake upload adapter for plugin and host tests. */
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
