/**
 * @file In-memory `AssetDataSource` (PRD 0002 §6). Adapts the synchronous
 * `AssetRegistry` + the {@link FolderStore} into the async, folder-aware data
 * plane, WITHOUT changing the registry's API. The registry stays the single
 * store for assets; folder membership lives in the side-index the folder store
 * owns. Lazy-importable so flat callers pay nothing for folder code.
 */

import type {
	AssetDataSource,
	AssetSourceStatus,
	ReplacePayload,
} from "../types/data-source.js";
import type { AssetFilter, AssetListPage } from "../types/filter.js";
import type { AssetFolder, FolderId } from "../types/folders.js";
import { resolveFolderId } from "../types/folders.js";
import type {
	AssetRegistry,
	AssetSearchPage,
	UploadResult,
} from "../types/types.js";
import { AssetSourceError } from "./errors.js";
import { createFolderStore, type FolderStore } from "./folders.js";
import { assetMatchesSearch, paginateMatches } from "./registry.js";

/**
 * Binary ingest used by `replace` — the same `uploadAsset`-bound callback the
 * `StudioAssetSource` already threads, so the security pipeline is single-sourced.
 */
export type UploadFn = (
	file: File,
	options?: { readonly signal?: AbortSignal },
) => Promise<UploadResult>;

/** Fully-resolved data plane (no optional methods) stored on the runtime state. */
export interface ResolvedAssetDataSource {
	list(query: AssetFilter, signal?: AbortSignal): Promise<AssetListPage>;
	remove(id: string, signal?: AbortSignal): Promise<void>;
	replace(
		id: string,
		payload: ReplacePayload,
		signal?: AbortSignal,
	): Promise<UploadResult>;
	rename(id: string, name: string, signal?: AbortSignal): Promise<UploadResult>;
	move(
		id: string,
		folderId: FolderId | null,
		signal?: AbortSignal,
	): Promise<void>;
	createFolder(
		parentId: FolderId | null,
		name: string,
		signal?: AbortSignal,
	): Promise<AssetFolder>;
	renameFolder(
		id: FolderId,
		name: string,
		signal?: AbortSignal,
	): Promise<AssetFolder>;
	removeFolder(
		id: FolderId,
		opts?: { readonly cascade?: boolean },
		signal?: AbortSignal,
	): Promise<void>;
	moveFolder(
		id: FolderId,
		parentId: FolderId | null,
		signal?: AbortSignal,
	): Promise<AssetFolder>;
	/** Fires on any asset OR folder mutation (the sidebar re-lists). */
	subscribe(listener: () => void): () => void;
	subscribeStatus(listener: (status: AssetSourceStatus) => void): () => void;
	/** The shared folder store (for the composite source / UI). */
	readonly folders: FolderStore;
}

export interface CreateInMemoryDataSourceOptions {
	readonly registry: AssetRegistry;
	readonly upload: UploadFn;
	/** Shared folder store — injected by the factory so the UI sees the same one. */
	readonly folderStore?: FolderStore;
	/** Max nesting depth from `FolderOptions`. */
	readonly maxDepth?: number;
}

function makeAbortError(): Error {
	if (typeof DOMException !== "undefined") {
		return new DOMException("Operation aborted", "AbortError");
	}
	const error = new Error("Operation aborted");
	error.name = "AbortError";
	return error;
}

export function createInMemoryDataSource(
	options: CreateInMemoryDataSourceOptions,
): ResolvedAssetDataSource {
	const { registry, upload, maxDepth } = options;
	const folders = options.folderStore ?? createFolderStore();

	const buildPage = (
		page: AssetSearchPage,
		query: AssetFilter,
	): AssetListPage => {
		const base: AssetListPage = {
			items: page.items,
			total: page.total,
			nextCursor: page.nextCursor,
		};
		if (query.folderId === undefined) return base;
		return {
			...base,
			folders: folders.listChildren(query.folderId),
			folderPath: folders.path(query.folderId),
		};
	};

	return {
		folders,

		list(query) {
			if (query.folderId === undefined) {
				return Promise.resolve(buildPage(registry.search(query), query));
			}
			const target = resolveFolderId(query.folderId);
			const recursive = query.recursive === true;
			const subtree =
				recursive && target !== null ? folders.subtreeIds(target) : undefined;
			const matches = registry.list().filter((entry) => {
				const owner = folders.folderOf(entry.id);
				const folderOk = recursive
					? target === null
						? true
						: owner !== null && subtree?.has(owner) === true
					: owner === target;
				return folderOk && assetMatchesSearch(entry, query);
			});
			return Promise.resolve(buildPage(paginateMatches(matches, query), query));
		},

		remove(id) {
			registry.delete(id);
			folders.removeAsset(id);
			return Promise.resolve();
		},

		async replace(id, payload, signal) {
			const result = await upload(payload, signal ? { signal } : undefined);
			if (signal?.aborted) throw makeAbortError();
			const replaced = registry.replace(id, result);
			return replaced ?? result;
		},

		rename(id, name) {
			const updated = registry.rename(id, name);
			if (updated === undefined) {
				// Source-domain mutation failure — NOT the resolver's ASSET_NOT_FOUND
				// (PRD 0002 §3.6 reserves that for AssetResolutionError).
				return Promise.reject(
					new AssetSourceError(
						"ASSET_MUTATION_REJECTED",
						`Cannot rename unknown asset "${id}".`,
					),
				);
			}
			return Promise.resolve(updated);
		},

		move(id, folderId) {
			folders.moveAsset(id, folderId);
			return Promise.resolve();
		},

		createFolder(parentId, name) {
			return Promise.resolve(folders.createFolder(parentId, name, maxDepth));
		},

		renameFolder(id, name) {
			return Promise.resolve(folders.renameFolder(id, name));
		},

		removeFolder(id, opts) {
			const { removedAssetIds } = folders.removeFolder(id, opts);
			for (const assetId of removedAssetIds) registry.delete(assetId);
			return Promise.resolve();
		},

		moveFolder(id, parentId) {
			return Promise.resolve(folders.moveFolder(id, parentId, maxDepth));
		},

		subscribe(listener) {
			const offRegistry = registry.subscribe(listener);
			const offFolders = folders.subscribe(listener);
			return () => {
				offRegistry();
				offFolders();
			};
		},

		subscribeStatus(listener) {
			// Synchronous source: it is always idle (mutations are immediate and
			// infallible-or-throw). Emit once on attach; no further transitions.
			listener({ phase: "idle" });
			return () => {
				/* no async status stream to detach */
			};
		},
	};
}

const ASSET_PLANE = [
	"list",
	"remove",
	"replace",
	"rename",
	"move",
] as const satisfies readonly (keyof AssetDataSource)[];

const FOLDER_PLANE = [
	"createFolder",
	"renameFolder",
	"removeFolder",
	"moveFolder",
] as const satisfies readonly (keyof AssetDataSource)[];

export interface ResolveDataSourceInput
	extends CreateInMemoryDataSourceOptions {
	/** Host-supplied backend. When absent, the full in-memory default is used. */
	readonly hostDataSource?: AssetDataSource;
	/** One-time dev warning sink (e.g. `ctx.log`). */
	readonly warn?: (message: string) => void;
}

/**
 * Per-PLANE resolution ladder (PRD 0002 §5). A host that supplies the FULL
 * method set of a plane owns that plane; a PARTIAL set warns once and the WHOLE
 * plane falls back to the in-memory default — so the read and write planes are
 * never split across two stores. `subscribeStatus` is taken from the host when
 * present; `subscribe`/`folders` always come from the in-memory layer (the
 * composite re-lists after host mutations; external push is out of scope).
 */
export function resolveDataSource(
	input: ResolveDataSourceInput,
): ResolvedAssetDataSource {
	const fallback = createInMemoryDataSource(input);
	const host = input.hostDataSource;
	if (host === undefined) return fallback;

	const ownsPlane = (
		plane: readonly (keyof AssetDataSource)[],
		label: string,
	): boolean => {
		const provided = plane.filter((m) => typeof host[m] === "function");
		if (provided.length === 0) return false;
		if (provided.length === plane.length) return true;
		input.warn?.(
			`asset-manager: dataSource provides a partial ${label} method set (${provided.join(
				", ",
			)}) — falling back to the in-memory default for the whole ${label} plane. Provide all of {${plane.join(
				", ",
			)}} or none.`,
		);
		return false;
	};

	const resolved: ResolvedAssetDataSource = { ...fallback };

	if (ownsPlane(ASSET_PLANE, "asset")) {
		resolved.list = host.list!.bind(host);
		resolved.remove = host.remove!.bind(host);
		resolved.replace = host.replace!.bind(host);
		resolved.rename = host.rename!.bind(host);
		resolved.move = host.move!.bind(host);
	}
	if (ownsPlane(FOLDER_PLANE, "folder")) {
		resolved.createFolder = host.createFolder!.bind(host);
		resolved.renameFolder = host.renameFolder!.bind(host);
		resolved.removeFolder = host.removeFolder!.bind(host);
		resolved.moveFolder = host.moveFolder!.bind(host);
	}
	if (typeof host.subscribeStatus === "function") {
		resolved.subscribeStatus = host.subscribeStatus.bind(host);
	}

	return resolved;
}
