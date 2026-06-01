/**
 * @file `CompositeAssetSource` (PRD 0002 §6.1, §8.1). Implements core's
 * `StudioAssetSource` by routing reads + catalog mutations through the resolved
 * `AssetDataSource` (so host backends and folder scoping work), while reusing
 * the proven upload pipeline + projection from `createStudioAssetSource`.
 *
 * Lazy-loaded by the factory only when a host opts into a richer surface
 * (`dataSource`/`providers`/`unsplash`), so flat callers never pull this — or
 * the folder/data-source code it imports — into the headless entry chunk.
 */

import type {
	StudioAsset,
	StudioAssetListPage,
	StudioAssetListQuery,
	StudioAssetSource,
} from "@anvilkit/core/types";

import type { AssetFilter, AssetListPage } from "../types/filter.js";
import type { AssetFolder, FolderId } from "../types/folders.js";
import type { AssetRegistry, UploadResult } from "../types/types.js";
import { createAssetReference } from "../utils/asset-reference.js";
import type {
	ResolvedAssetDataSource,
	UploadFn,
} from "../utils/data-source.js";
import {
	createStudioAssetSource,
	toStudioAsset,
} from "../utils/studio-asset-source.js";
import { createLocalProvider, federatedSearch } from "./federated-search.js";
import type { AssetSourceProvider } from "./provider.js";

export interface CreateCompositeAssetSourceOptions {
	readonly source: ResolvedAssetDataSource;
	readonly registry: AssetRegistry;
	readonly upload: UploadFn;
	readonly getThumbnail?: (entry: UploadResult) => string | undefined;
	/** External read-only sources (e.g. Unsplash) federated alongside the local library. */
	readonly providers?: readonly AssetSourceProvider[];
}

/**
 * The core `StudioAssetSource` plus the folder methods the plugin's `./ui` and
 * (Phase 2) core `ImageModule` consume. The folder methods are additive — core
 * ignores what it doesn't know until its sidebar types adopt them.
 */
export interface CompositeAssetSource extends StudioAssetSource {
	createFolder(parentId: FolderId | null, name: string): Promise<AssetFolder>;
	renameFolder(id: FolderId, name: string): Promise<AssetFolder>;
	removeFolder(
		id: FolderId,
		opts?: { readonly cascade?: boolean },
	): Promise<void>;
	moveFolder(id: FolderId, parentId: FolderId | null): Promise<AssetFolder>;
	moveAsset(assetId: string, folderId: FolderId | null): Promise<void>;
}

export function createCompositeAssetSource(
	options: CreateCompositeAssetSourceOptions,
): CompositeAssetSource {
	const { source, registry, upload, getThumbnail } = options;

	// Reuse the battle-tested upload pipeline (concurrency workers, progress
	// events, abort) + tag editing + upload subscriptions. Reads + catalog
	// mutations are overridden below to flow through the resolved data source.
	const base = createStudioAssetSource({
		registry,
		upload,
		...(getThumbnail ? { getThumbnail } : {}),
	});

	const project = (entry: UploadResult): StudioAsset =>
		toStudioAsset(entry, getThumbnail);

	// Local library is always provider[0]; external providers federate alongside.
	const providers: readonly AssetSourceProvider[] = [
		createLocalProvider(source, registry),
		...(options.providers ?? []),
	];

	// Single (local-only) → fast path straight to the data source; multiple →
	// federate (route/merge + composite cursor).
	const runList = (
		filter: AssetFilter,
		signal?: AbortSignal,
	): Promise<AssetListPage> =>
		providers.length === 1
			? source.list(filter, signal)
			: federatedSearch({ providers, filter, signal });

	return {
		async list() {
			const page = await runList({});
			return Object.freeze(page.items.map(project));
		},

		async listPaginated(
			query: StudioAssetListQuery,
		): Promise<StudioAssetListPage> {
			// StudioAssetListQuery's fields (query/kinds/tags/cursor/limit) are a
			// subset of AssetFilter; folder scoping + source tabs arrive via the
			// plugin's ./ui / the Phase-2 core sidebar query extension.
			const page = await runList({ ...query });
			return {
				items: Object.freeze(page.items.map(project)),
				total: page.total,
				nextCursor: page.nextCursor,
			};
		},

		// Upload + tags + upload-subscription reuse the base (registry-backed) source.
		upload: base.upload,
		setTags: base.setTags,
		subscribeUploads: base.subscribeUploads,
		getUrl: (assetId) => createAssetReference(assetId),

		async delete(assetId) {
			await source.remove(assetId);
		},
		async rename(assetId, nextName) {
			await source.rename(assetId, nextName);
		},
		async replace(assetId, file) {
			return project(await source.replace(assetId, file));
		},

		subscribe: (listener) => source.subscribe(listener),

		// ── folder surface (additive; consumed by ./ui + Phase-2 core) ──
		createFolder: (parentId, name) => source.createFolder(parentId, name),
		renameFolder: (id, name) => source.renameFolder(id, name),
		removeFolder: (id, opts) => source.removeFolder(id, opts),
		moveFolder: (id, parentId) => source.moveFolder(id, parentId),
		moveAsset: (assetId, folderId) => source.move(assetId, folderId),
	};
}
