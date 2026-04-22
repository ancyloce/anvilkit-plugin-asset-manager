export interface AssetMeta {
	readonly size?: number;
	readonly mimeType?: string;
	readonly width?: number;
	readonly height?: number;
}

export interface UploadResult {
	readonly url: string;
	readonly id: string;
	readonly meta?: AssetMeta;
}

export type UploadAdapter = (file: File) => Promise<UploadResult>;

export interface AssetManagerOptions {
	readonly uploader: UploadAdapter;
	readonly maxFileSize?: number;
	readonly acceptedMimeTypes?: readonly string[];
	readonly urlAllowlist?: readonly string[];
}

export interface AssetRegistry {
	readonly register: (asset: UploadResult) => UploadResult;
	readonly get: (id: string) => UploadResult | undefined;
	readonly list: () => readonly UploadResult[];
}
