/**
 * @file Best-effort image dimension extraction for reference adapters.
 *
 * Decodes an image URL via the `Image` constructor and resolves the
 * `naturalWidth` / `naturalHeight`. Returns `undefined` when the runtime
 * has no `Image` global (SSR), the MIME type is not `image/*`, the decode
 * fails, or the timeout elapses — adapters must succeed regardless.
 *
 * The resolved values are integers ≥ 1; degenerate sizes (0, NaN) are
 * filtered out so consumers can rely on the shape.
 */

export interface ExtractImageDimensionsOptions {
	/** Abort decode after this many ms. Default 3000. */
	readonly timeoutMs?: number;
}

export interface ImageDimensions {
	readonly width: number;
	readonly height: number;
}

const DEFAULT_TIMEOUT_MS = 3000;

export async function extractImageDimensions(
	url: string,
	mimeType: string | undefined,
	options: ExtractImageDimensionsOptions = {},
): Promise<ImageDimensions | undefined> {
	if (!mimeType || !mimeType.startsWith("image/")) {
		return undefined;
	}

	if (typeof Image === "undefined") {
		return undefined;
	}

	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

	return new Promise<ImageDimensions | undefined>((resolve) => {
		let settled = false;
		const image = new Image();

		const settle = (value: ImageDimensions | undefined) => {
			if (settled) return;
			settled = true;
			image.onload = null;
			image.onerror = null;
			if (timer !== undefined) {
				clearTimeout(timer);
			}
			resolve(value);
		};

		image.onload = () => {
			const width = Math.round(image.naturalWidth);
			const height = Math.round(image.naturalHeight);
			if (
				!Number.isFinite(width) ||
				!Number.isFinite(height) ||
				width < 1 ||
				height < 1
			) {
				settle(undefined);
				return;
			}
			settle({ width, height });
		};

		image.onerror = () => {
			settle(undefined);
		};

		const timer =
			timeoutMs > 0
				? setTimeout(() => {
						settle(undefined);
					}, timeoutMs)
				: undefined;

		image.src = url;
	});
}
