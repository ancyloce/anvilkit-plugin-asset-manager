/**
 * @file The unified host-facing data plane (PRD 0002 §3.3, §3.6).
 *
 * `AssetDataSource` is the ONE optional object a host supplies to back the local
 * library. Every method is optional and async-first; any method (resolved
 * per-plane) the host omits is filled by the built-in in-memory default. Binary
 * ingest is NOT here — it stays on the top-level `uploader` (`UploadAdapter`).
 *
 * The READ is unified: `list()` returns the folder's assets, its child folders,
 * and its breadcrumb in one envelope — there is deliberately no `listFolders`.
 * Folder *mutations* are a separate plane.
 */

import type { AssetSourceError } from "../utils/errors.js";
import type { AssetFilter, AssetListPage } from "./filter.js";
import type { AssetFolder, FolderId } from "./folders.js";
import type { UploadResult } from "./types.js";

/**
 * Replacement payload for {@link AssetDataSource.replace}. Kept `File`-only for
 * parity with core's `StudioAssetSource.replace` boundary; programmatic
 * `UploadResult` replacement stays on the registry.
 */
export type ReplacePayload = File;

/** Loading/mutation status surfaced through {@link AssetDataSource.subscribeStatus}. */
export type AssetSourceStatus =
	| { readonly phase: "idle" }
	| { readonly phase: "loading" }
	| { readonly phase: "paginating"; readonly loaded: number }
	| {
			readonly phase: "mutating";
			readonly op:
				| "rename"
				| "remove"
				| "move"
				| "replace"
				| "createFolder"
				| "removeFolder"
				| "moveFolder";
			readonly id: string;
	  }
	| { readonly phase: "error"; readonly error: AssetSourceError };

/** Host-supplied read and mutation plane for the local asset library. */
export interface AssetDataSource {
	// ── Asset + folder READ plane (one unified call) ─────────────────
	/**
	 * THE single read. Scoped by `query.folderId` (null=root, undefined=all),
	 * returns the folder's assets (paginated `items`), its child `folders`, and
	 * its `folderPath` breadcrumb in one envelope. No separate `listFolders`.
	 */
	list?(query: AssetFilter, signal?: AbortSignal): Promise<AssetListPage>;

	// ── Asset mutation plane (resolves together) ─────────────────────
	/** Remove an asset by id from the backing library. */
	remove?(id: string, signal?: AbortSignal): Promise<void>;
	/** Replace an asset's binary contents and return the updated upload row. */
	replace?(
		id: string,
		payload: ReplacePayload,
		signal?: AbortSignal,
	): Promise<UploadResult>;
	/** Rename an asset and return the updated upload row. */
	rename?(
		id: string,
		name: string,
		signal?: AbortSignal,
	): Promise<UploadResult>;
	/** Move an asset into a folder. `null` ⇒ root. */
	move?(
		id: string,
		folderId: FolderId | null,
		signal?: AbortSignal,
	): Promise<void>;

	// ── Folder mutation plane (reads come from `list` above) ─────────
	/** Create a child folder under `parentId`, or under root when `null`. */
	createFolder?(
		parentId: FolderId | null,
		name: string,
		signal?: AbortSignal,
	): Promise<AssetFolder>;
	/** Rename a folder and return the updated folder record. */
	renameFolder?(
		id: FolderId,
		name: string,
		signal?: AbortSignal,
	): Promise<AssetFolder>;
	/** Remove a folder, optionally cascading through descendants and assets. */
	removeFolder?(
		id: FolderId,
		opts?: { readonly cascade?: boolean },
		signal?: AbortSignal,
	): Promise<void>;
	/** Move a folder under `parentId`, or to root when `null`. */
	moveFolder?(
		id: FolderId,
		parentId: FolderId | null,
		signal?: AbortSignal,
	): Promise<AssetFolder>;

	// ── Status plane (optional) ──────────────────────────────────────
	/** Subscribe to data-source loading and mutation status updates. */
	subscribeStatus?(listener: (status: AssetSourceStatus) => void): () => void;
}
