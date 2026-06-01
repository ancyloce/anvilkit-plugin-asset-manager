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

export interface AssetDataSource {
	// ── Asset + folder READ plane (one unified call) ─────────────────
	/**
	 * THE single read. Scoped by `query.folderId` (null=root, undefined=all),
	 * returns the folder's assets (paginated `items`), its child `folders`, and
	 * its `folderPath` breadcrumb in one envelope. No separate `listFolders`.
	 */
	list?(query: AssetFilter, signal?: AbortSignal): Promise<AssetListPage>;

	// ── Asset mutation plane (resolves together) ─────────────────────
	remove?(id: string, signal?: AbortSignal): Promise<void>;
	replace?(
		id: string,
		payload: ReplacePayload,
		signal?: AbortSignal,
	): Promise<UploadResult>;
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
	createFolder?(
		parentId: FolderId | null,
		name: string,
		signal?: AbortSignal,
	): Promise<AssetFolder>;
	renameFolder?(
		id: FolderId,
		name: string,
		signal?: AbortSignal,
	): Promise<AssetFolder>;
	removeFolder?(
		id: FolderId,
		opts?: { readonly cascade?: boolean },
		signal?: AbortSignal,
	): Promise<void>;
	moveFolder?(
		id: FolderId,
		parentId: FolderId | null,
		signal?: AbortSignal,
	): Promise<AssetFolder>;

	// ── Status plane (optional) ──────────────────────────────────────
	subscribeStatus?(listener: (status: AssetSourceStatus) => void): () => void;
}
