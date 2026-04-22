export class AssetValidationError extends Error {
	readonly code: string;

	constructor(code: string, message: string, options?: { readonly cause?: unknown }) {
		super(message);
		this.name = "AssetValidationError";
		this.code = code;

		if (options && "cause" in options) {
			this.cause = options.cause;
		}
	}
}

export class AssetResolutionError extends Error {
	readonly assetId: string;

	constructor(
		assetId: string,
		message = `Could not resolve asset "${assetId}"`,
		options?: { readonly cause?: unknown },
	) {
		super(message);
		this.name = "AssetResolutionError";
		this.assetId = assetId;

		if (options && "cause" in options) {
			this.cause = options.cause;
		}
	}
}
