/**
 * @file Folder model for the asset library (PRD 0002 §3.1).
 *
 * Folders form an arbitrarily-deep tree keyed by {@link AssetFolder.parentId};
 * `null` is the single root convention everywhere a folder id is accepted —
 * there is no string sentinel. Folder *membership* (which folder an asset lives
 * in) is a registry-owned side-index, NOT a field on `UploadResult`, so these
 * types never bleed into the freeze/validate reconstruction of an asset.
 */

/** Canonical id of a folder. `null` (never a real id) denotes the root. */
export type FolderId = string;

export interface AssetFolder {
	readonly id: FolderId;
	/** Display name; trimmed, non-empty. Siblings are case-insensitively unique. */
	readonly name: string;
	/** Parent container. `null` ⇒ top level. */
	readonly parentId: FolderId | null;
	/** Epoch-ms creation timestamp (stamped via an injected clock, test-friendly). */
	readonly createdAt: number;
	/** Epoch-ms last-mutation timestamp. */
	readonly updatedAt: number;
	/**
	 * Denormalized direct-child counts for cheap tree rendering. NEVER the
	 * source of truth for membership — the asset→folder side-index is.
	 */
	readonly counts: {
		readonly assets: number;
		readonly folders: number;
	};
	/** Optional host-opaque metadata (e.g. color label, ACL). */
	readonly meta?: Readonly<Record<string, string | number | boolean>>;
}

export interface FolderOptions {
	/** Maximum nesting depth. `undefined` ⇒ unbounded. */
	readonly maxDepth?: number;
	/** Allow moving assets/folders. `undefined` ⇒ treated as `true`. */
	readonly allowMove?: boolean;
}

/**
 * Normalize a folder-id input to the canonical root convention: `undefined`
 * and `null` both collapse to `null` (root); a real id is returned unchanged.
 * This is the only folder-id normalization helper — there is no `__root__`
 * sentinel to expand or collapse.
 */
export function resolveFolderId(folderId?: FolderId | null): FolderId | null {
	return folderId ?? null;
}
