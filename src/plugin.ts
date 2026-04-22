import type {
	PageIRAsset,
	StudioPlugin,
	StudioPluginContext,
	StudioPluginRegistration,
} from "@anvilkit/core/types";

import { AssetValidationError } from "./errors.js";
import { uploadAssetAction } from "./header-action.js";
import { createAssetRegistry } from "./registry.js";
import type { AssetManagerOptions, AssetMeta, AssetRegistry, UploadResult } from "./types.js";
import { validateUploadResult } from "./validate-upload-result.js";

const META = {
	id: "anvilkit-plugin-asset-manager",
	name: "Asset Manager",
	version: "0.1.0-alpha.0",
	coreVersion: "^0.1.0-alpha",
	description:
		"Headless asset upload plugin with host-provided persistence and a separate React UI subpath.",
} as const;

interface AssetManagerRuntimeState {
	readonly options: NormalizedAssetManagerOptions;
	readonly registry: AssetRegistry;
}

interface NormalizedAssetManagerOptions extends AssetManagerOptions {
	readonly acceptedMimeTypes?: readonly string[];
	readonly urlAllowlist?: readonly string[];
}

const stateByToken = new WeakMap<object, AssetManagerRuntimeState>();
const tokenByContext = new WeakMap<StudioPluginContext, object>();

export function createAssetManagerPlugin(options: AssetManagerOptions): StudioPlugin {
	const token = {};
	const registry = createAssetRegistry();
	const normalizedOptions = normalizeOptions(options);

	return {
		meta: META,
		register(_ctx) {
			const registration: StudioPluginRegistration = {
				meta: META,
				headerActions: [uploadAssetAction],
				hooks: {
					onInit(initCtx) {
						stateByToken.set(token, {
							options: normalizedOptions,
							registry,
						});
						tokenByContext.set(initCtx, token);
					},
					onDestroy(destroyCtx) {
						tokenByContext.delete(destroyCtx);
						stateByToken.delete(token);
					},
				},
			};

			return registration;
		},
	};
}

export function getAssetRegistry(
	ctx: StudioPluginContext,
): AssetRegistry | undefined {
	const token = tokenByContext.get(ctx);
	return token ? stateByToken.get(token)?.registry : undefined;
}

export async function uploadAsset(
	ctx: StudioPluginContext,
	file: File,
): Promise<UploadResult> {
	const state = getRuntimeState(ctx);
	const { options, registry } = state;

	try {
		validateSelectedFile(file, options);

		const uploadResult = await options.uploader(file);
		const validated = validateUploadResult(
			mergeUploadMeta(uploadResult, file),
			options,
		);
		const stored = registry.register(validated);
		dispatchAssetReference(ctx, stored);
		ctx.emit("asset-manager:uploaded", {
			asset: stored,
			reference: createAssetReference(stored.id),
		});

		return stored;
	} catch (error) {
		const normalizedError =
			error instanceof AssetValidationError
				? error
				: new AssetValidationError(
						"UPLOAD_FAILED",
						error instanceof Error ? error.message : String(error),
						{ cause: error },
					);

		ctx.emit("asset-manager:error", {
			code: normalizedError.code,
			message: normalizedError.message,
		});
		ctx.log("error", normalizedError.message, {
			code: normalizedError.code,
		});
		throw normalizedError;
	}
}

export function validateSelectedFile(
	file: File,
	options: Pick<AssetManagerOptions, "acceptedMimeTypes" | "maxFileSize">,
): void {
	if (options.maxFileSize !== undefined && file.size > options.maxFileSize) {
		throw new AssetValidationError(
			"FILE_TOO_LARGE",
			`File size ${file.size} bytes exceeds the configured maxFileSize of ${options.maxFileSize} bytes.`,
		);
	}

	if (
		options.acceptedMimeTypes &&
		options.acceptedMimeTypes.length > 0 &&
		!mimeTypeMatches(file.type, options.acceptedMimeTypes)
	) {
		const mimeType = file.type || "unknown";
		throw new AssetValidationError(
			"UNSUPPORTED_MIME_TYPE",
			`File MIME type "${mimeType}" is not in acceptedMimeTypes.`,
		);
	}
}

export function createAssetReference(id: string): string {
	return `asset://${id}`;
}

function getRuntimeState(ctx: StudioPluginContext): AssetManagerRuntimeState {
	const token = tokenByContext.get(ctx);
	const state = token ? stateByToken.get(token) : undefined;
	if (!state) {
		throw new Error(
			"createAssetManagerPlugin: uploadAsset called before the plugin runtime was initialized.",
		);
	}

	return state;
}

function normalizeOptions(options: AssetManagerOptions): NormalizedAssetManagerOptions {
	return {
		...options,
		...(options.acceptedMimeTypes
			? { acceptedMimeTypes: Object.freeze([...options.acceptedMimeTypes]) }
			: {}),
		...(options.urlAllowlist
			? { urlAllowlist: Object.freeze([...options.urlAllowlist]) }
			: {}),
	};
}

function mergeUploadMeta(result: UploadResult, file: File): UploadResult {
	const meta: AssetMeta = {
		size: file.size,
		...(file.type ? { mimeType: file.type } : {}),
		...(result.meta ?? {}),
	};

	return {
		...result,
		meta,
	};
}

function mimeTypeMatches(
	input: string,
	acceptedMimeTypes: readonly string[],
): boolean {
	if (input === "") {
		return false;
	}

	return acceptedMimeTypes.some((accepted) => {
		if (accepted.endsWith("/*")) {
			const prefix = accepted.slice(0, accepted.length - 1);
			return input.startsWith(prefix);
		}

		return input === accepted;
	});
}

function dispatchAssetReference(
	ctx: StudioPluginContext,
	asset: UploadResult,
): void {
	const currentData = ctx.getData() as Record<string, unknown>;
	const currentAssets = Array.isArray(currentData.assets)
		? currentData.assets.filter(isRecord)
		: [];
	const assetEntry = toIRAsset(asset);
	const nextAssets = [
		...currentAssets.filter((entry) => entry.id !== asset.id),
		assetEntry,
	];
	const nextData = {
		...currentData,
		assets: nextAssets,
	};

	ctx.getPuckApi().dispatch({
		type: "setData",
		data: nextData as unknown as ReturnType<StudioPluginContext["getData"]>,
	});
}

function toIRAsset(asset: UploadResult): PageIRAsset {
	return {
		id: asset.id,
		kind: inferAssetKind(asset.meta?.mimeType, asset.url),
		url: createAssetReference(asset.id),
		...(asset.meta ? { meta: asset.meta as Readonly<Record<string, unknown>> } : {}),
	};
}

function inferAssetKind(
	mimeType: string | undefined,
	url: string,
): PageIRAsset["kind"] {
	if (mimeType?.startsWith("image/")) {
		return "image";
	}

	if (mimeType?.startsWith("video/")) {
		return "video";
	}

	if (
		mimeType?.startsWith("font/") ||
		/\.(?:woff2?|ttf|otf)(?:$|[?#])/i.test(url)
	) {
		return "font";
	}

	if (mimeType === "text/css") {
		return "style";
	}

	if (
		mimeType === "application/javascript" ||
		mimeType === "text/javascript"
	) {
		return "script";
	}

	return "other";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
