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
