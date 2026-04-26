export type { DataUrlUploaderOptions } from "./adapters/data-url.js";
export { dataUrlUploader } from "./adapters/data-url.js";
export { inMemoryUploader } from "./adapters/in-memory.js";
export {
	AssetResolutionError,
	AssetValidationError,
} from "./errors.js";
export {
	createAssetManagerPlugin,
	createAssetReference,
	getAssetRegistry,
	uploadAsset,
} from "./plugin.js";
export { createAssetRegistry } from "./registry.js";
export type { CreateIRAssetResolverOptions } from "./resolver.js";
export { createIRAssetResolver, resolveAssets } from "./resolver.js";
export type {
	AssetManagerOptions,
	AssetMeta,
	AssetRegistry,
	UploadAdapter,
	UploadResult,
} from "./types.js";
export { validateUploadResult } from "./validate-upload-result.js";
