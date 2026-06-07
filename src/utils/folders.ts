/**
 * @file In-memory folder store (PRD 0002 §7). Lazy-importable from the factory
 * so flat callers pay zero headless bytes for it.
 *
 * Owns the folder tree (records) and the asset→folder side-index. Membership is
 * stored ONLY for non-root assets (absence ⇒ root), so `UploadResult` is never
 * extended and the registry's freeze reconstructor can't strip a folder field.
 * `AssetFolder.counts` is served from two reverse indexes — `childrenByParent`
 * (parent → child folder ids) and `folderAssets` (folder → direct asset ids) —
 * kept in lockstep with the authoritative maps via centralized mutation helpers,
 * so projection, `listChildren`, and subtree walks are O(result size) instead of
 * O(every record), and the counts still cannot drift from the side-index.
 */

import type { AssetFolder, FolderId } from "../types/folders.js";
import { resolveFolderId } from "../types/folders.js";
import { AssetSourceError } from "./errors.js";

interface FolderRecord {
	id: FolderId;
	name: string;
	parentId: FolderId | null;
	readonly createdAt: number;
	updatedAt: number;
}

export interface CreateFolderStoreOptions {
	/** Injectable clock for deterministic timestamps in tests. Defaults to `Date.now`. */
	readonly now?: () => number;
}

export interface FolderStore {
	/** Direct child folders of `parentId` (`null`/undefined ⇒ root's children). */
	listChildren(parentId?: FolderId | null): readonly AssetFolder[];
	/** All folders, flat. */
	listAll(): readonly AssetFolder[];
	get(id: FolderId): AssetFolder | undefined;
	/** Root → … → `id` (inclusive). `[]` for root/undefined. */
	path(id?: FolderId | null): readonly AssetFolder[];

	createFolder(
		parentId: FolderId | null,
		name: string,
		maxDepth?: number,
	): AssetFolder;
	renameFolder(id: FolderId, name: string): AssetFolder;
	moveFolder(
		id: FolderId,
		parentId: FolderId | null,
		maxDepth?: number,
	): AssetFolder;
	/**
	 * Remove a folder. Default policy reparents children (folders + assets) to
	 * the removed folder's parent; `{ cascade: true }` instead returns every
	 * descendant asset id for the caller to delete from the registry.
	 */
	removeFolder(
		id: FolderId,
		opts?: { readonly cascade?: boolean },
	): { readonly removedAssetIds: readonly string[] };

	/** Owning folder of an asset (`null` ⇒ root). */
	folderOf(assetId: string): FolderId | null;
	moveAsset(assetId: string, folderId: FolderId | null): void;
	/** Batch move — validates the target once (all-or-nothing) before applying. */
	moveAssets(assetIds: readonly string[], folderId: FolderId | null): void;
	/** Drop an asset's membership (call when the asset is deleted from the registry). */
	removeAsset(assetId: string): void;

	/** Folder id + every descendant folder id (for recursive listing). */
	subtreeIds(id: FolderId): ReadonlySet<FolderId>;

	/** Asset ids directly contained by `id` (membership only; no descendants). */
	directAssetIds(id: FolderId): readonly string[];

	subscribe(listener: () => void): () => void;
}

export function createFolderStore(
	options: CreateFolderStoreOptions = {},
): FolderStore {
	const now = options.now ?? (() => Date.now());
	const records = new Map<FolderId, FolderRecord>();
	const assetFolder = new Map<string, FolderId>(); // non-root memberships only
	const listeners = new Set<() => void>();
	let seq = 0;

	// Reverse indexes mirroring the authoritative maps above. `childrenByParent`
	// mirrors `records[].parentId` (the `null` key holds the root's children);
	// `folderAssets` mirrors `assetFolder` the other way (folder → its direct
	// asset ids). EVERY write to `records`/`assetFolder` routes through the
	// link/membership helpers below so these indexes can never drift.
	const childrenByParent = new Map<FolderId | null, Set<FolderId>>();
	const folderAssets = new Map<FolderId, Set<string>>();

	const notify = (): void => {
		for (const listener of listeners) listener();
	};

	const requireRecord = (id: FolderId): FolderRecord => {
		const rec = records.get(id);
		if (rec === undefined) {
			throw new AssetSourceError("FOLDER_NOT_FOUND", `Unknown folder "${id}".`);
		}
		return rec;
	};

	const linkChild = (parentId: FolderId | null, childId: FolderId): void => {
		let set = childrenByParent.get(parentId);
		if (set === undefined) {
			set = new Set<FolderId>();
			childrenByParent.set(parentId, set);
		}
		set.add(childId);
	};

	const unlinkChild = (parentId: FolderId | null, childId: FolderId): void => {
		const set = childrenByParent.get(parentId);
		if (set === undefined) return;
		set.delete(childId);
		if (set.size === 0) childrenByParent.delete(parentId);
	};

	const detachAsset = (assetId: string, folderId: FolderId): void => {
		const set = folderAssets.get(folderId);
		if (set === undefined) return;
		set.delete(assetId);
		if (set.size === 0) folderAssets.delete(folderId);
	};

	/** Point an asset at a folder, keeping both membership indexes in sync. */
	const setMembership = (assetId: string, folderId: FolderId): void => {
		const prev = assetFolder.get(assetId);
		if (prev === folderId) return;
		if (prev !== undefined) detachAsset(assetId, prev);
		assetFolder.set(assetId, folderId);
		let set = folderAssets.get(folderId);
		if (set === undefined) {
			set = new Set<string>();
			folderAssets.set(folderId, set);
		}
		set.add(assetId);
	};

	/** Drop an asset's membership (→ root). Returns whether it had one. */
	const clearMembership = (assetId: string): boolean => {
		const prev = assetFolder.get(assetId);
		if (prev === undefined) return false;
		assetFolder.delete(assetId);
		detachAsset(assetId, prev);
		return true;
	};

	const childFolderCount = (id: FolderId): number =>
		childrenByParent.get(id)?.size ?? 0;

	const directAssetCount = (id: FolderId): number =>
		folderAssets.get(id)?.size ?? 0;

	const project = (rec: FolderRecord): AssetFolder =>
		Object.freeze({
			id: rec.id,
			name: rec.name,
			parentId: rec.parentId,
			createdAt: rec.createdAt,
			updatedAt: rec.updatedAt,
			counts: Object.freeze({
				assets: directAssetCount(rec.id),
				folders: childFolderCount(rec.id),
			}),
		});

	const depthOf = (id: FolderId | null): number => {
		let depth = 0;
		let cursor = id;
		while (cursor !== null) {
			const rec = records.get(cursor);
			if (rec === undefined) break;
			depth += 1;
			cursor = rec.parentId;
		}
		return depth;
	};

	const subtree = (id: FolderId): Set<FolderId> => {
		// DFS over the parent→children adjacency index — visits only the
		// descendants of `id`, never every folder in the store.
		const out = new Set<FolderId>([id]);
		const stack: FolderId[] = [id];
		while (stack.length > 0) {
			const current = stack.pop();
			if (current === undefined) continue;
			const kids = childrenByParent.get(current);
			if (kids === undefined) continue;
			for (const kid of kids) {
				if (!out.has(kid)) {
					out.add(kid);
					stack.push(kid);
				}
			}
		}
		return out;
	};

	const heightOf = (id: FolderId): number => {
		let height = 0;
		const ids = subtree(id);
		for (const fid of ids) {
			const d = depthOf(fid) - depthOf(id);
			if (d > height) height = d;
		}
		return height;
	};

	const assertNameFree = (
		parentId: FolderId | null,
		name: string,
		exceptId?: FolderId,
	): void => {
		const lowered = name.toLowerCase();
		const siblings = childrenByParent.get(parentId);
		if (siblings === undefined) return;
		for (const sibId of siblings) {
			if (sibId === exceptId) continue;
			const rec = records.get(sibId);
			if (rec !== undefined && rec.name.toLowerCase() === lowered) {
				throw new AssetSourceError(
					"FOLDER_NAME_CONFLICT",
					`A folder named "${name}" already exists here.`,
				);
			}
		}
	};

	const normalizeName = (name: string): string => {
		const trimmed = name.trim();
		if (trimmed === "") {
			throw new AssetSourceError(
				"FOLDER_NAME_CONFLICT",
				"Folder name must not be empty.",
			);
		}
		return trimmed;
	};

	const assertDepthOk = (
		parentDepth: number,
		extraHeight: number,
		maxDepth: number | undefined,
	): void => {
		if (maxDepth === undefined) return;
		// New folder sits at parentDepth + 1; its subtree extends `extraHeight` below.
		if (parentDepth + 1 + extraHeight > maxDepth) {
			throw new AssetSourceError(
				"MOVE_REJECTED",
				`Operation would exceed the maximum folder depth of ${maxDepth}.`,
			);
		}
	};

	return {
		listChildren(parentId) {
			const target = resolveFolderId(parentId);
			const ids = childrenByParent.get(target);
			if (ids === undefined) return Object.freeze([]);
			const out: AssetFolder[] = [];
			for (const id of ids) {
				const rec = records.get(id);
				if (rec !== undefined) out.push(project(rec));
			}
			return Object.freeze(out);
		},

		listAll() {
			return Object.freeze([...records.values()].map(project));
		},

		get(id) {
			const rec = records.get(id);
			return rec === undefined ? undefined : project(rec);
		},

		path(id) {
			const target = resolveFolderId(id);
			if (target === null) return Object.freeze([]);
			const chain: AssetFolder[] = [];
			let cursor: FolderId | null = target;
			const seen = new Set<FolderId>();
			while (cursor !== null) {
				if (seen.has(cursor)) break; // defensive: never loop on corrupt state
				seen.add(cursor);
				const rec = records.get(cursor);
				if (rec === undefined) break;
				chain.unshift(project(rec));
				cursor = rec.parentId;
			}
			return Object.freeze(chain);
		},

		createFolder(parentId, name, maxDepth) {
			const target = resolveFolderId(parentId);
			if (target !== null) requireRecord(target);
			const clean = normalizeName(name);
			assertNameFree(target, clean);
			assertDepthOk(depthOf(target), 0, maxDepth);
			const ts = now();
			const rec: FolderRecord = {
				id: `folder-${(seq += 1)}`,
				name: clean,
				parentId: target,
				createdAt: ts,
				updatedAt: ts,
			};
			records.set(rec.id, rec);
			linkChild(target, rec.id);
			notify();
			return project(rec);
		},

		renameFolder(id, name) {
			const rec = requireRecord(id);
			const clean = normalizeName(name);
			assertNameFree(rec.parentId, clean, id);
			rec.name = clean;
			rec.updatedAt = now();
			notify();
			return project(rec);
		},

		moveFolder(id, parentId, maxDepth) {
			const rec = requireRecord(id);
			const target = resolveFolderId(parentId);
			if (target === id) {
				throw new AssetSourceError(
					"FOLDER_CYCLE",
					"A folder cannot be moved into itself.",
				);
			}
			if (target !== null) {
				requireRecord(target);
				// Cycle guard: target must not be inside id's subtree.
				if (subtree(id).has(target)) {
					throw new AssetSourceError(
						"FOLDER_CYCLE",
						"A folder cannot be moved into one of its own descendants.",
					);
				}
			}
			if (rec.parentId === target) return project(rec); // no-op
			assertNameFree(target, rec.name, id);
			assertDepthOk(depthOf(target), heightOf(id), maxDepth);
			unlinkChild(rec.parentId, id);
			rec.parentId = target;
			rec.updatedAt = now();
			linkChild(target, id);
			notify();
			return project(rec);
		},

		removeFolder(id, opts) {
			const rec = requireRecord(id);
			if (opts?.cascade) {
				const ids = subtree(id);
				const removedAssetIds: string[] = [];
				for (const fid of ids) {
					const assetsHere = folderAssets.get(fid);
					if (assetsHere !== undefined) {
						for (const assetId of assetsHere) {
							removedAssetIds.push(assetId);
							assetFolder.delete(assetId);
						}
						folderAssets.delete(fid);
					}
					childrenByParent.delete(fid);
					records.delete(fid);
				}
				unlinkChild(rec.parentId, id);
				notify();
				return { removedAssetIds: Object.freeze(removedAssetIds) };
			}
			// Reparent children (folders + assets) to the removed folder's parent.
			const newParent = rec.parentId;
			const childIds = [...(childrenByParent.get(id) ?? [])];
			for (const childId of childIds) {
				const child = records.get(childId);
				if (child === undefined) continue;
				child.parentId = newParent;
				child.updatedAt = now();
				linkChild(newParent, childId);
			}
			childrenByParent.delete(id);
			const assetIds = [...(folderAssets.get(id) ?? [])];
			for (const assetId of assetIds) {
				if (newParent === null) clearMembership(assetId);
				else setMembership(assetId, newParent);
			}
			unlinkChild(newParent, id);
			records.delete(id);
			notify();
			return { removedAssetIds: Object.freeze([]) };
		},

		folderOf(assetId) {
			return assetFolder.get(assetId) ?? null;
		},

		moveAsset(assetId, folderId) {
			const target = resolveFolderId(folderId);
			if (target !== null) requireRecord(target);
			if (target === null) clearMembership(assetId);
			else setMembership(assetId, target);
			notify();
		},

		moveAssets(assetIds, folderId) {
			const target = resolveFolderId(folderId);
			if (target !== null) requireRecord(target); // validate once (all-or-nothing)
			for (const assetId of assetIds) {
				if (target === null) clearMembership(assetId);
				else setMembership(assetId, target);
			}
			notify();
		},

		removeAsset(assetId) {
			if (clearMembership(assetId)) notify();
		},

		subtreeIds(id) {
			return subtree(id);
		},

		directAssetIds(id) {
			const set = folderAssets.get(id);
			return set === undefined ? Object.freeze([]) : Object.freeze([...set]);
		},

		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}
