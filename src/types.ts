export interface AssetMeta {
	readonly size?: number;
	readonly mimeType?: string;
	readonly width?: number;
	readonly height?: number;
}

export interface UploadResult {
	readonly url: string;
	readonly id: string;
	/**
	 * Optional human-readable name. The plugin's `uploadAsset()` seeds
	 * this from the source `File`'s `name` so the sidebar can render a
	 * filename under each tile; uploader adapters may also populate it
	 * directly when they know a friendlier label.
	 */
	readonly name?: string;
	readonly meta?: AssetMeta;
}

export type UploadAdapter = (file: File) => Promise<UploadResult>;

export interface AssetManagerOptions {
	readonly uploader: UploadAdapter;
	readonly maxFileSize?: number;
	readonly acceptedMimeTypes?: readonly string[];
	readonly urlAllowlist?: readonly string[];
}

/**
 * Listener invoked after every registry mutation
 * (`register` / `delete` / `rename` / `replace`). The `studio-asset-source`
 * adapter wires its own listener set onto the registry so the sidebar
 * re-runs `list()` whenever an asset changes.
 */
export type AssetRegistryListener = () => void;

export interface AssetRegistry {
	readonly register: (asset: UploadResult) => UploadResult;
	readonly get: (id: string) => UploadResult | undefined;
	readonly list: () => readonly UploadResult[];
	/** Remove an asset. Returns `true` if an entry was removed. */
	readonly delete: (id: string) => boolean;
	/**
	 * Rename an asset in-place. Returns the updated entry, or `undefined`
	 * if no asset with that id exists.
	 */
	readonly rename: (id: string, name: string) => UploadResult | undefined;
	/**
	 * Replace an asset in-place. Preserves the entry's `id` even if the
	 * incoming `next` carries a different one. Returns the updated entry,
	 * or `undefined` if no asset with that id exists.
	 */
	readonly replace: (id: string, next: UploadResult) => UploadResult | undefined;
	/**
	 * Subscribe to mutation notifications. The returned function
	 * unsubscribes the listener.
	 */
	readonly subscribe: (listener: AssetRegistryListener) => () => void;
}
