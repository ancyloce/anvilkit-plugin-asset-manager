import type {
	PageIRAsset,
	StudioPlugin,
	StudioPluginContext,
	StudioPluginRegistration,
} from "@anvilkit/core/types";
import type { Config as PuckConfig } from "@puckeditor/core";

import config from "../meta/config.json";
import packageJson from "../package.json";
import type {
	AssetManagerOptions,
	AssetMeta,
	AssetRegistry,
	UploadResult,
} from "./types/types.js";
import { createAssetReference } from "./utils/asset-reference.js";
import { AssetValidationError } from "./utils/errors.js";
import { uploadAssetAction } from "./utils/header-action.js";
import { inferAssetKind } from "./utils/infer-kind.js";
import { createAssetRegistry } from "./utils/registry.js";
import { createIRAssetResolver } from "./utils/resolver.js";
import { createStudioAssetSource } from "./utils/studio-asset-source.js";
import { validateUploadResult } from "./utils/validate-upload-result.js";

export { createAssetReference };

// `version` is derived from package.json so a Changesets bump can never drift
// the runtime metadata; `plugin.metadata-drift.test.ts` guards regressions.
const META = {
	...config,
	version: packageJson.version,
} as const;

interface AssetManagerRuntimeState {
	readonly options: NormalizedAssetManagerOptions;
	readonly registry: AssetRegistry;
	readonly cleanups: Array<() => void>;
}

interface NormalizedAssetManagerOptions extends AssetManagerOptions {
	readonly acceptedMimeTypes?: readonly string[];
}

const stateByToken = new WeakMap<object, AssetManagerRuntimeState>();
// Keyed by `object` rather than `StudioPluginContext<…>` so the map stays
// agnostic to the plugin's `UserConfig` type parameter.
const tokenByContext = new WeakMap<object, object>();

export function createAssetManagerPlugin<
	UserConfig extends PuckConfig = PuckConfig,
>(options: AssetManagerOptions): StudioPlugin<UserConfig> {
	const token = {};
	const registry = createAssetRegistry();
	const normalizedOptions = normalizeOptions(options);
	const assetResolver = createIRAssetResolver({
		registry,
		dataUrlAllowlistOptIn: normalizedOptions.dataUrlAllowlistOptIn,
		allowMixedScriptHostnames: normalizedOptions.allowMixedScriptHostnames,
	});

	return {
		meta: META,
		register(_ctx) {
			const registration: StudioPluginRegistration<UserConfig> = {
				meta: META,
				headerActions: [uploadAssetAction],
				hooks: {
					onInit(initCtx) {
						const cleanups: Array<() => void> = [];
						stateByToken.set(token, {
							options: normalizedOptions,
							registry,
							cleanups,
						});
						tokenByContext.set(initCtx, token);
						initCtx.registerAssetResolver(assetResolver);

						const studioAssetSource = createStudioAssetSource({
							registry,
							upload: (file, opts) => uploadAsset(initCtx, file, opts?.signal),
							...(normalizedOptions.getThumbnail
								? { getThumbnail: normalizedOptions.getThumbnail }
								: {}),
						});
						const unregisterAssetSource =
							initCtx.registerAssetSource?.(studioAssetSource);
						if (unregisterAssetSource !== undefined) {
							cleanups.push(unregisterAssetSource);
						}
					},
					onDestroy(destroyCtx) {
						const state = stateByToken.get(token);
						if (state !== undefined) {
							for (const cleanup of state.cleanups) {
								cleanup();
							}
						}
						tokenByContext.delete(destroyCtx);
						stateByToken.delete(token);
					},
				},
			};

			return registration;
		},
	};
}

export function getAssetRegistry<UserConfig extends PuckConfig = PuckConfig>(
	ctx: StudioPluginContext<UserConfig>,
): AssetRegistry | undefined {
	const token = tokenByContext.get(ctx);
	return token ? stateByToken.get(token)?.registry : undefined;
}

export async function uploadAsset<UserConfig extends PuckConfig = PuckConfig>(
	ctx: StudioPluginContext<UserConfig>,
	file: File,
	signal?: AbortSignal,
): Promise<UploadResult> {
	const state = getRuntimeState(ctx);
	const { options, registry } = state;

	try {
		validateSelectedFile(file, options);

		const uploadResult = await options.uploader(
			file,
			signal ? { signal } : undefined,
		);
		// Adapters may ignore or only partially honor the abort signal — bail
		// here BEFORE registering or dispatching so a cancelled batch can't
		// mutate the registry / Puck data after unmount.
		if (signal?.aborted) {
			throw makePluginAbortError();
		}
		const validated = validateUploadResult(
			mergeUploadMeta(uploadResult, file),
			options,
		);
		const tagged = withDerivedTags(validated, file);
		const stored = registry.register(tagged);
		dispatchAssetReference(ctx, stored);
		ctx.emit("asset-manager:uploaded", {
			asset: stored,
			reference: createAssetReference(stored.id),
		});

		return stored;
	} catch (error) {
		// Cancellation is not a user-facing failure — re-throw the original
		// AbortError so callers (StudioAssetSource.upload) can distinguish
		// it from a real upload error and skip the error toast / emit.
		if (isAbortLikeError(error) || signal?.aborted) {
			throw error;
		}

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

function getRuntimeState<UserConfig extends PuckConfig = PuckConfig>(
	ctx: StudioPluginContext<UserConfig>,
): AssetManagerRuntimeState {
	const token = tokenByContext.get(ctx);
	const state = token ? stateByToken.get(token) : undefined;
	if (!state) {
		throw new Error(
			"createAssetManagerPlugin: uploadAsset called before the plugin runtime was initialized.",
		);
	}

	return state;
}

function normalizeOptions(
	options: AssetManagerOptions,
): NormalizedAssetManagerOptions {
	return {
		...options,
		...(options.acceptedMimeTypes
			? { acceptedMimeTypes: Object.freeze([...options.acceptedMimeTypes]) }
			: {}),
	};
}

/**
 * Derive a small, capped set of library tags so search and the sidebar
 * filter row work on the very first upload. Hosts can override or
 * extend the set later via `AssetRegistry.setTags`. Tag rules:
 *
 * - Always include the inferred kind (`image` / `video` / `audio` /
 *   `font` / `document`).
 * - Include up to two filename tokens drawn from `file.name` (after
 *   stripping the extension) — split on common separators, lowercased,
 *   length ≥ 2, alphanumeric only. Skips numeric-only tokens (`100`,
 *   `2024`) which carry no library signal.
 * - Caps total at 3 to keep the sidebar chip row readable.
 *
 * If the host-supplied `UploadResult` already carries `tags`, those are
 * preserved verbatim — derivation only fills in an empty array.
 */
function withDerivedTags(asset: UploadResult, file: File): UploadResult {
	if (asset.tags !== undefined && asset.tags.length > 0) {
		return asset;
	}
	const tags = new Set<string>();
	const kind = inferAssetKind(asset);
	if (kind !== "other") {
		tags.add(kind);
	}
	for (const token of filenameTokens(file.name)) {
		if (tags.size >= 3) break;
		tags.add(token);
	}
	if (tags.size === 0) {
		return asset;
	}
	return { ...asset, tags: Object.freeze([...tags]) };
}

function filenameTokens(name: string): readonly string[] {
	const stem = name.replace(/\.[^./\\]+$/, "");
	const tokens = stem
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((token) => token.length >= 2 && !/^\d+$/.test(token));
	return tokens.slice(0, 2);
}

function mergeUploadMeta(result: UploadResult, file: File): UploadResult {
	const meta: AssetMeta = {
		size: file.size,
		...(file.type ? { mimeType: file.type } : {}),
		...(result.meta ?? {}),
	};

	return {
		...result,
		...(result.name === undefined && file.name ? { name: file.name } : {}),
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

function dispatchAssetReference<UserConfig extends PuckConfig = PuckConfig>(
	ctx: StudioPluginContext<UserConfig>,
	asset: UploadResult,
): void {
	const currentData = ctx.getData();
	// Page data carries an opaque `assets` array the IR resolver consumes;
	// it isn't part of the public `getData()` shape, so read it through a
	// single narrow view instead of widening the whole object.
	const assetsView = (currentData as { assets?: unknown }).assets;
	const currentAssetsRaw = Array.isArray(assetsView) ? assetsView : [];
	const assetEntry = toIRAsset(asset);

	// Single linear pass — replace the matching entry in place, otherwise
	// append. Avoids the prior double-pass (`filter` + spread) that
	// rebuilt the full array on every dispatch.
	const nextAssets: unknown[] = [];
	let replaced = false;
	for (const entry of currentAssetsRaw) {
		if (
			isRecord(entry) &&
			typeof entry.id === "string" &&
			entry.id === asset.id
		) {
			nextAssets.push(assetEntry);
			replaced = true;
		} else {
			nextAssets.push(entry);
		}
	}
	if (!replaced) {
		nextAssets.push(assetEntry);
	}

	// `nextData` is `currentData` plus the opaque `assets` array, so it is
	// structurally a supertype-compatible value for the `setData` payload —
	// no `as unknown as` round-trip needed.
	const nextData = {
		...currentData,
		assets: nextAssets,
	};

	ctx.getPuckApi().dispatch({
		type: "setData",
		data: nextData,
	});
}

function toIRAsset(asset: UploadResult): PageIRAsset {
	return {
		id: asset.id,
		kind: inferIRAssetKind(asset.meta?.mimeType, asset.url),
		url: createAssetReference(asset.id),
		...(asset.meta
			? { meta: asset.meta as Readonly<Record<string, unknown>> }
			: {}),
	};
}

function inferIRAssetKind(
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

	if (mimeType === "application/javascript" || mimeType === "text/javascript") {
		return "script";
	}

	return "other";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/** Build a name-tagged `AbortError` for cancelled upload paths. */
function makePluginAbortError(): Error {
	if (typeof DOMException !== "undefined") {
		return new DOMException("Upload aborted", "AbortError");
	}
	const error = new Error("Upload aborted");
	error.name = "AbortError";
	return error;
}

function isAbortLikeError(error: unknown): boolean {
	if (error === null || typeof error !== "object") return false;
	const name = (error as { name?: unknown }).name;
	return name === "AbortError";
}
