import type {
	PageIRAsset,
	StudioPlugin,
	StudioPluginContext,
	StudioPluginRegistration,
} from "@anvilkit/core/types";
import type { Config as PuckConfig } from "@puckeditor/core";
import { Images } from "lucide-react";
import { createElement } from "react";

import config from "../meta/config.json" with { type: "json" };
import { inMemoryUploader } from "./adapters/in-memory.js";
import { ASSET_MANAGER_ENTRY } from "./i18n/entry.js";
// Type-only: erased at build, so these lazy modules never enter the headless entry.
import type { CompositeAssetSource } from "./sources/composite-source.js";
import type { AssetSourceProvider } from "./sources/provider.js";
import type { AssetManagerOptions } from "./types/options.js";
import type { ResumableUploadConfig } from "./types/resumable.js";
import type {
	AssetDeletedHook,
	AssetMeta,
	AssetRegistry,
	UploadAdapter,
	UploadResult,
} from "./types/types.js";
import { createAssetReference } from "./utils/asset-reference.js";
import type { UploadFn } from "./utils/data-source.js";
import { AssetValidationError } from "./utils/errors.js";
import { uploadAssetAction } from "./utils/header-action.js";
import { inferAssetKind } from "./utils/infer-kind.js";
import { createAssetRegistry } from "./utils/registry.js";
import { createIRAssetResolver } from "./utils/resolver.js";
import { createStudioAssetSource } from "./utils/studio-asset-source.js";
import { validateUploadResult } from "./utils/validate-upload-result.js";
import { ASSET_MANAGER_VERSION } from "./version.js";

export { createAssetReference };

/** Event name emitted after an asset upload has been validated and registered. */
export const ASSET_MANAGER_UPLOADED_EVENT = "asset-manager:uploaded" as const;

/** Event name emitted when upload validation or adapter execution fails. */
export const ASSET_MANAGER_ERROR_EVENT = "asset-manager:error" as const;

/** Payload emitted with {@link ASSET_MANAGER_UPLOADED_EVENT}. */
export interface AssetManagerUploadedEvent {
	readonly asset: UploadResult;
	readonly reference: string;
}

/** Payload emitted with {@link ASSET_MANAGER_ERROR_EVENT}. */
export interface AssetManagerErrorEvent {
	readonly code: string;
	readonly message: string;
}

/**
 * Event payload map for asset-manager runtime notifications. Hosts can use this
 * to type their event-bus wrappers around `asset-manager:uploaded` and
 * `asset-manager:error`.
 */
export interface AssetManagerEventMap {
	readonly [ASSET_MANAGER_UPLOADED_EVENT]: AssetManagerUploadedEvent;
	readonly [ASSET_MANAGER_ERROR_EVENT]: AssetManagerErrorEvent;
}

/** Supported asset-manager event names. */
export type AssetManagerEventName = keyof AssetManagerEventMap;

// `version` comes from the hand-maintained `version.ts` constant rather than a
// `package.json` import, which esbuild would inline whole and blow the gzip
// budget. `plugin.metadata-drift.test.ts` asserts it matches package.json, so a
// Changesets bump can never drift the runtime metadata.
const META = {
	...config,
	version: ASSET_MANAGER_VERSION,
	icon: createElement(Images),
} as const;

interface AssetManagerRuntimeState {
	readonly options: NormalizedAssetManagerOptions;
	readonly registry: AssetRegistry;
	readonly cleanups: Array<() => void>;
}

interface NormalizedAssetManagerOptions extends AssetManagerOptions {
	/** Resolved to a concrete uploader — the host's or the in-memory default. */
	readonly uploader: UploadAdapter;
	readonly acceptedMimeTypes?: readonly string[];
	readonly acceptedFileExtensions?: readonly string[];
}

const stateByToken = new WeakMap<object, AssetManagerRuntimeState>();
// Keyed by `object` rather than `StudioPluginContext<…>` so the map stays
// agnostic to the plugin's `UserConfig` type parameter.
const tokenByContext = new WeakMap<object, object>();

/**
 * Create the Anvilkit Studio asset-manager plugin.
 *
 * The returned plugin registers localization messages, a header upload action,
 * an IR asset resolver, and a Studio asset source. With no options it provides
 * an in-memory uploader/library; production hosts typically provide an
 * `uploader` and optionally a folder-aware `dataSource` or external providers.
 */
export function createAssetManagerPlugin<
	UserConfig extends PuckConfig = PuckConfig,
>(options: AssetManagerOptions = {}): StudioPlugin<UserConfig> {
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
		register(ctx) {
			// Contribute the `assetManager.*` message catalog so the in-chrome
			// surfaces (header action, sidebar sources) localize via `useMsg`.
			ctx.registerMessages(ASSET_MANAGER_ENTRY);
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

						const upload: UploadFn = (file, opts) =>
							uploadAsset(initCtx, file, opts?.signal);
						const onDelete = createAssetDeletedHandler(
							normalizedOptions,
							!hostOwnsAssetPlane(normalizedOptions),
						);

						// Lightweight registry-backed source, registered synchronously for
						// immediate sidebar availability + zero new headless bytes.
						const studioAssetSource = createStudioAssetSource({
							registry,
							upload,
							onDelete,
							...(normalizedOptions.getThumbnail
								? { getThumbnail: normalizedOptions.getThumbnail }
								: {}),
						});
						let unregisterAssetSource =
							initCtx.registerAssetSource?.(studioAssetSource);
						cleanups.push(() => unregisterAssetSource?.());

						// Richer surface (host dataSource / providers / Unsplash) is loaded
						// lazily so the folder + data-source + composite code never enters
						// the headless entry chunk, then swapped in for the lightweight one.
						if (needsRichSource(normalizedOptions)) {
							let disposed = false;
							cleanups.push(() => {
								disposed = true;
							});
							void loadRichSource(initCtx, registry, upload, normalizedOptions)
								.then((composite) => {
									if (disposed) return;
									unregisterAssetSource?.();
									unregisterAssetSource = undefined;
									const unregisterComposite =
										initCtx.registerAssetSource?.(composite);
									if (disposed) {
										unregisterComposite?.();
										return;
									}
									cleanups.push(() => unregisterComposite?.());
								})
								.catch((error) => {
									initCtx.log(
										"error",
										"asset-manager: failed to load the data source.",
										{ error },
									);
								});
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

/**
 * Return the runtime registry associated with an initialized plugin context.
 *
 * The registry is available after the plugin `onInit` hook has run and is
 * removed during `onDestroy`; callers should handle `undefined` in setup,
 * teardown, and tests that inspect lifecycle boundaries.
 */
export function getAssetRegistry<UserConfig extends PuckConfig = PuckConfig>(
	ctx: StudioPluginContext<UserConfig>,
): AssetRegistry | undefined {
	const token = tokenByContext.get(ctx);
	return token ? stateByToken.get(token)?.registry : undefined;
}

/**
 * Validate and upload a single file through the configured plugin runtime.
 *
 * The pipeline enforces selected-file constraints, calls the resolved upload
 * adapter, validates the adapter's `UploadResult`, derives lightweight tags,
 * registers the asset, dispatches an `asset://` reference into page data, and
 * emits typed asset-manager events.
 */
export async function uploadAsset<UserConfig extends PuckConfig = PuckConfig>(
	ctx: StudioPluginContext<UserConfig>,
	file: File,
	signal?: AbortSignal,
): Promise<UploadResult> {
	const state = getRuntimeState(ctx);
	const { options, registry } = state;

	try {
		validateSelectedFile(file, options);

		// Content dedup (opt-in): hash the bytes first; if an asset with the same
		// digest already exists, reuse it instead of re-uploading. Reference is
		// still dispatched so the drop inserts the (existing) asset.
		let contentHash: string | undefined;
		if (options.dedupe === true) {
			// Don't read/hash a whole (possibly large) file for an already-cancelled
			// upload.
			if (signal?.aborted) {
				throw makePluginAbortError();
			}
			contentHash = await computeFileHash(file);
			if (signal?.aborted) {
				throw makePluginAbortError();
			}
			if (contentHash !== undefined) {
				const existing = registry
					.list()
					.find((entry) => entry.meta?.hash === contentHash);
				if (existing !== undefined) {
					dispatchAssetReference(ctx, existing);
					ctx.emit(ASSET_MANAGER_UPLOADED_EVENT, {
						asset: existing,
						reference: createAssetReference(existing.id),
					});
					return existing;
				}
			}
		}

		const uploadResult = await performUpload(options, file, signal);
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
		// Stamp the computed digest so future uploads can dedup against it.
		const hashed =
			contentHash !== undefined
				? {
						...validated,
						meta: { ...(validated.meta ?? {}), hash: contentHash },
					}
				: validated;
		const tagged = withDerivedTags(hashed, file);
		const stored = registry.register(tagged);
		dispatchAssetReference(ctx, stored);
		const payload: AssetManagerUploadedEvent = {
			asset: stored,
			reference: createAssetReference(stored.id),
		};
		ctx.emit(ASSET_MANAGER_UPLOADED_EVENT, payload);

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

		const payload: AssetManagerErrorEvent = {
			code: normalizedError.code,
			message: normalizedError.message,
		};
		ctx.emit(ASSET_MANAGER_ERROR_EVENT, payload);
		ctx.log("error", normalizedError.message, {
			code: normalizedError.code,
		});
		throw normalizedError;
	}
}

/**
 * 8 MiB — matches the resumable runner's default part size. Used as the resume
 * threshold when neither `resumable.threshold` nor `resumable.partSize` is set
 * (a file that fits in a single part gains nothing from multipart).
 */
const DEFAULT_RESUMABLE_THRESHOLD = 8 * 1024 * 1024;

/**
 * Select the upload path: files at or above the resumable threshold go through
 * the multipart runner (chunked, per-part retry, resumable across reloads);
 * everything else uses the single-shot `uploader`. Both return a raw
 * `UploadResult` that the caller runs through `validateUploadResult`, so the
 * trust boundary is identical regardless of path.
 *
 * The runner (and its session-store dependency) is loaded LAZILY only when a
 * resumable upload actually fires, so flat/single-shot callers never pull it —
 * or the chunking/persistence code — into the eager headless entry chunk.
 */
async function performUpload(
	options: NormalizedAssetManagerOptions,
	file: File,
	signal: AbortSignal | undefined,
): Promise<UploadResult> {
	const { resumable } = options;
	if (resumable !== undefined && shouldUseResumable(resumable, file)) {
		// Fast-abort before fetching the lazy runner chunk — an already-cancelled
		// upload shouldn't pay a network round-trip for code it won't run.
		if (signal?.aborted) {
			throw makePluginAbortError();
		}
		const { runResumableUpload } = await import(
			"./utils/run-resumable-upload.js"
		);
		return runResumableUpload(resumable.adapter, file, {
			...(resumable.partSize !== undefined
				? { partSize: resumable.partSize }
				: {}),
			...(resumable.sessionStore
				? { sessionStore: resumable.sessionStore }
				: {}),
			...(signal ? { signal } : {}),
		});
	}
	return options.uploader(file, signal ? { signal } : undefined);
}

function shouldUseResumable(
	resumable: ResumableUploadConfig,
	file: File,
): boolean {
	const threshold =
		resumable.threshold ?? resumable.partSize ?? DEFAULT_RESUMABLE_THRESHOLD;
	return file.size >= threshold;
}

/**
 * Asset-deletion lifecycle handler threaded into the (default) sources. Revokes
 * `blob:` object URLs so the built-in `inMemoryUploader` no longer leaks them
 * (PRD 0004 §5 — M6), then invokes the host's optional `onAssetDeleted` hook.
 */
function createAssetDeletedHandler(
	options: NormalizedAssetManagerOptions,
	callHostHook: boolean,
): AssetDeletedHook {
	return async (asset) => {
		// Always revoke blob: URLs (harmless safety net). The host `onAssetDeleted`
		// hook only fires for the default-owned asset plane — when a host
		// `dataSource` owns deletion it runs the host's own `remove`, so firing the
		// hook here too would double-signal the deletion.
		revokeBlobUrl(asset.url);
		if (callHostHook) await options.onAssetDeleted?.(asset);
	};
}

/**
 * Whether the host's `dataSource` owns asset DELETION — i.e. it implements the
 * FULL asset-plane method set, so `resolveDataSource` routes `remove` to it. A
 * folder-only or partial `dataSource` leaves the in-memory plane owning deletes,
 * so the `onAssetDeleted` hook should still fire there. Mirrors the `ASSET_PLANE`
 * ladder in `utils/data-source.ts` — keep the method list in sync.
 */
const HOST_ASSET_PLANE_METHODS = [
	"list",
	"remove",
	"replace",
	"rename",
	"move",
] as const;

function hostOwnsAssetPlane(options: NormalizedAssetManagerOptions): boolean {
	const ds = options.dataSource;
	if (ds === undefined) return false;
	return HOST_ASSET_PLANE_METHODS.every(
		(method) => typeof (ds as Record<string, unknown>)[method] === "function",
	);
}

function revokeBlobUrl(url: string): void {
	if (
		url.startsWith("blob:") &&
		typeof URL !== "undefined" &&
		typeof URL.revokeObjectURL === "function"
	) {
		URL.revokeObjectURL(url);
	}
}

/**
 * SHA-256 of the file bytes as lowercase hex, or `undefined` when the platform
 * lacks `crypto.subtle` / `File.arrayBuffer` (e.g. older runtimes) — dedup then
 * degrades to a normal upload rather than failing.
 */
async function computeFileHash(file: File): Promise<string | undefined> {
	const subtle = globalThis.crypto?.subtle;
	if (subtle === undefined || typeof file.arrayBuffer !== "function") {
		return undefined;
	}
	try {
		const digest = await subtle.digest("SHA-256", await file.arrayBuffer());
		const bytes = new Uint8Array(digest);
		let hex = "";
		for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
		return hex;
	} catch {
		return undefined;
	}
}

export function validateSelectedFile(
	file: File,
	options: Pick<
		AssetManagerOptions,
		"acceptedFileExtensions" | "acceptedMimeTypes" | "maxFileSize"
	>,
): void {
	if (options.maxFileSize !== undefined && file.size > options.maxFileSize) {
		throw new AssetValidationError(
			"FILE_TOO_LARGE",
			`File size ${file.size} bytes exceeds the configured maxFileSize of ${options.maxFileSize} bytes.`,
		);
	}

	const acceptedMimeTypes = options.acceptedMimeTypes ?? [];
	const acceptedFileExtensions = options.acceptedFileExtensions ?? [];
	const hasMimeAllowlist = acceptedMimeTypes.length > 0;
	const hasExtensionAllowlist = acceptedFileExtensions.length > 0;

	if (
		hasMimeAllowlist &&
		file.type !== "" &&
		!mimeTypeMatches(file.type, acceptedMimeTypes)
	) {
		throw new AssetValidationError(
			"UNSUPPORTED_MIME_TYPE",
			`File MIME type "${file.type}" is not in acceptedMimeTypes.`,
		);
	}
	if (hasMimeAllowlist && file.type === "" && !hasExtensionAllowlist) {
		throw new AssetValidationError(
			"UNSUPPORTED_MIME_TYPE",
			'File MIME type "unknown" is not in acceptedMimeTypes.',
		);
	}
	if (
		hasExtensionAllowlist &&
		!fileExtensionMatches(file.name, acceptedFileExtensions)
	) {
		const extension = file.name.includes(".")
			? file.name.slice(file.name.lastIndexOf(".")).toLowerCase()
			: "unknown";
		throw new AssetValidationError(
			"UNSUPPORTED_FILE_EXTENSION",
			`File extension "${extension}" is not in acceptedFileExtensions.`,
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

/**
 * Whether to load the richer composite source. Folders are ON by default
 * (PRD 0002 §4.1), so any caller that hasn't explicitly set `folders: false`
 * gets the composite (folder-aware sidebar). It also engages for a host
 * backend, extra providers, or Unsplash. Only `folders: false` + no
 * backend/provider keeps the lightweight, flat registry source.
 */
function needsRichSource(options: NormalizedAssetManagerOptions): boolean {
	return (
		options.folders !== false ||
		options.dataSource !== undefined ||
		(options.providers !== undefined && options.providers.length > 0) ||
		options.unsplash !== undefined
	);
}

/**
 * Dynamically import the data-source + composite modules (own async chunk) and
 * assemble the composite over the resolved data plane. Keeping these behind
 * `import()` is what holds the headless entry under its gzip budget.
 */
async function loadRichSource<UserConfig extends PuckConfig = PuckConfig>(
	ctx: StudioPluginContext<UserConfig>,
	registry: AssetRegistry,
	upload: UploadFn,
	options: NormalizedAssetManagerOptions,
): Promise<CompositeAssetSource> {
	const [{ resolveDataSource }, { createCompositeAssetSource }] =
		await Promise.all([
			import("./utils/data-source.js"),
			import("./sources/composite-source.js"),
		]);
	const maxDepth =
		typeof options.folders === "object" ? options.folders.maxDepth : undefined;
	const allowMove =
		typeof options.folders === "object" ? options.folders.allowMove : undefined;
	const resolved = resolveDataSource({
		registry,
		upload,
		onDelete: createAssetDeletedHandler(options, !hostOwnsAssetPlane(options)),
		...(options.dataSource ? { hostDataSource: options.dataSource } : {}),
		...(maxDepth !== undefined ? { maxDepth } : {}),
		...(allowMove !== undefined ? { allowMove } : {}),
		warn: (message) => ctx.log("warn", message),
	});

	const providers: AssetSourceProvider[] = [...(options.providers ?? [])];
	if (options.unsplash !== undefined) {
		// Own lazy chunk — the Unsplash client/themes never enter this one either.
		const { createUnsplashProvider, unsplashEnabled } = await import(
			"./sources/unsplash/index.js"
		);
		if (unsplashEnabled(options.unsplash)) {
			if (
				options.unsplash.accessKey !== undefined &&
				options.unsplash.proxyEndpoint === undefined
			) {
				ctx.log(
					"warn",
					"asset-manager: the Unsplash accessKey is public in the browser — use a server proxy (proxyEndpoint) in production.",
				);
			}
			providers.push(createUnsplashProvider(options.unsplash));
		}
	}

	return createCompositeAssetSource({
		source: resolved,
		registry,
		upload,
		...(providers.length > 0 ? { providers } : {}),
		...(options.getThumbnail ? { getThumbnail: options.getThumbnail } : {}),
	});
}

function normalizeOptions(
	options: AssetManagerOptions,
): NormalizedAssetManagerOptions {
	return {
		...options,
		// Zero-config: omitting `uploader` resolves the in-memory default so
		// `createAssetManagerPlugin()` works with no args (PRD 0002 §4/§5). The
		// resolved value is non-optional, so every internal `options.uploader(...)`
		// call site stays type-safe. The dataSource/folder per-plane ladder is
		// resolved separately via `resolveDataSource` (wired in `onInit`).
		uploader: options.uploader ?? inMemoryUploader(),
		...(options.acceptedMimeTypes
			? { acceptedMimeTypes: Object.freeze([...options.acceptedMimeTypes]) }
			: {}),
		...(options.acceptedFileExtensions
			? {
					acceptedFileExtensions: Object.freeze([
						...options.acceptedFileExtensions,
					]),
				}
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

function fileExtensionMatches(
	name: string,
	acceptedFileExtensions: readonly string[],
): boolean {
	const lowerName = name.toLowerCase();
	if (lowerName === "") {
		return false;
	}

	return acceptedFileExtensions.some((accepted) => {
		const trimmed = accepted.trim().toLowerCase();
		if (trimmed === "") {
			return false;
		}
		const extension = trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
		return lowerName.endsWith(extension);
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
