export class AssetValidationError extends Error {
	readonly code: string;

	constructor(
		code: string,
		message: string,
		options?: { readonly cause?: unknown },
	) {
		super(message);
		this.name = "AssetValidationError";
		this.code = code;

		if (options && "cause" in options) {
			this.cause = options.cause;
		}
	}
}

/**
 * Failure codes raised by the async data-source / folder / external-provider
 * surfaces (PRD 0002 §3.6). Distinct from {@link AssetValidationError}
 * (upload validation) and {@link AssetResolutionError} (resolver domain) — in
 * particular `ASSET_NOT_FOUND` belongs to the resolver, never here.
 */
export type AssetSourceErrorCode =
	| "DATA_SOURCE_UNAVAILABLE"
	| "DATA_SOURCE_TIMEOUT"
	| "FOLDER_NOT_FOUND"
	| "FOLDER_CYCLE"
	| "FOLDER_NAME_CONFLICT"
	| "FOLDER_NOT_EMPTY"
	| "MOVE_REJECTED"
	| "PROVIDER_RATE_LIMITED"
	| "PROVIDER_UNAUTHORIZED"
	| "PROVIDER_NETWORK"
	| "PROVIDER_BAD_RESPONSE"
	| "READ_ONLY_SOURCE"
	| "OPTIMISTIC_ROLLBACK";

/**
 * Error for async catalog operations: host `dataSource` failures, folder
 * mutations, and external `AssetSourceProvider` calls (e.g. Unsplash). Carries
 * retry metadata so callers can drive backoff (`./retry`) without re-deriving
 * it: `retryable` gates whether a retry is attempted at all, `status` mirrors
 * an HTTP status (429, 401, …), and `retryAfterMs` is sourced from a
 * `Retry-After` / `X-Ratelimit-Reset` header when present.
 */
export class AssetSourceError extends Error {
	readonly code: AssetSourceErrorCode;
	readonly retryable: boolean;
	readonly status?: number;
	readonly retryAfterMs?: number;

	constructor(
		code: AssetSourceErrorCode,
		message: string,
		options?: {
			readonly cause?: unknown;
			readonly retryable?: boolean;
			readonly status?: number;
			readonly retryAfterMs?: number;
		},
	) {
		super(message);
		this.name = "AssetSourceError";
		this.code = code;
		this.retryable = options?.retryable ?? false;
		this.status = options?.status;
		this.retryAfterMs = options?.retryAfterMs;

		if (options && "cause" in options) {
			this.cause = options.cause;
		}
	}
}

export type AssetResolutionErrorCode =
	| "ASSET_NOT_FOUND"
	| "ASSET_URL_REJECTED"
	| "ASSET_VALIDATION_FAILED";

export class AssetResolutionError extends Error {
	readonly assetId: string;
	readonly code: AssetResolutionErrorCode;

	constructor(
		assetId: string,
		code: AssetResolutionErrorCode = "ASSET_NOT_FOUND",
		message = `Could not resolve asset "${assetId}"`,
		options?: { readonly cause?: unknown },
	) {
		super(message);
		this.name = "AssetResolutionError";
		this.assetId = assetId;
		this.code = code;

		if (options && "cause" in options) {
			this.cause = options.cause;
		}
	}
}
