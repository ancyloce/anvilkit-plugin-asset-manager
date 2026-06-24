/**
 * @file CSP advisor — computes the minimum `connect-src` / `img-src` /
 * `media-src` directives a host page needs in order for the
 * configured adapters and their served URLs to load. Pure static
 * derivation; no network or DOM dependencies.
 *
 * The host calls this once at boot with a description of which
 * adapters are wired in, then merges the result into its existing CSP
 * builder.
 *
 * @example
 *   const csp = getRequiredCsp({
 *     dataUrl: true,
 *     s3: { presignEndpoint: "https://uploads.example.com/sign" },
 *   });
 *   // csp.connectSrc → ["https://uploads.example.com"]
 *   // csp.imgSrc     → ["data:"]
 *   // csp.mediaSrc   → ["data:"]
 */

export interface S3CspOptions {
	/** The presign endpoint configured on `s3PresignedAdapter`. */
	readonly presignEndpoint: string | URL;
	/**
	 * Optional public-bucket origin (e.g. `https://cdn.example.com`).
	 * If your `publicUrl` returned by the presign service points at a
	 * different host than the presign endpoint itself, list it here so
	 * the advisor can include it in `img-src` / `media-src`.
	 */
	readonly publicHost?: string;
}

/** CSP inputs for an `s3MultipartAdapter` instance. */
export interface S3MultipartCspOptions {
	/** The broker `endpoint` configured on `s3MultipartAdapter`. */
	readonly endpoint: string | URL;
	/**
	 * Origin that part PUTs and the completed object live on (e.g.
	 * `https://my-bucket.s3.amazonaws.com`). Presigned part URLs target it
	 * directly, so it must be in `connect-src`. When omitted, only the broker
	 * endpoint origin is added and you must allow the bucket origin yourself.
	 */
	readonly bucketHost?: string;
	/**
	 * Separate public/CDN origin the completed object is served from, if it
	 * differs from `bucketHost`. Added to `connect-src` / `img-src` /
	 * `media-src`.
	 */
	readonly publicHost?: string;
}

/** Inputs describing which asset backends need CSP allowances. */
export interface RequiredCspOptions {
	/** True if `dataUrlUploader` is mounted. Defaults to false. */
	readonly dataUrl?: boolean;
	/** True if `inMemoryUploader` is mounted. Defaults to false. */
	readonly inMemory?: boolean;
	/** Description of any `s3PresignedAdapter` instance(s). */
	readonly s3?: S3CspOptions | readonly S3CspOptions[];
	/** Description of any `s3MultipartAdapter` instance(s). */
	readonly s3Multipart?:
		| S3MultipartCspOptions
		| readonly S3MultipartCspOptions[];
}

/** Computed CSP directive sources needed for configured asset backends. */
export interface RequiredCsp {
	readonly connectSrc: readonly string[];
	readonly imgSrc: readonly string[];
	readonly mediaSrc: readonly string[];
}

/** Compute CSP origins required by the configured asset upload backends. */
export function getRequiredCsp(options: RequiredCspOptions = {}): RequiredCsp {
	const connectSrc = new Set<string>();
	const imgSrc = new Set<string>();
	const mediaSrc = new Set<string>();

	if (options.dataUrl === true) {
		imgSrc.add("data:");
		mediaSrc.add("data:");
	}

	if (options.inMemory === true) {
		imgSrc.add("blob:");
		mediaSrc.add("blob:");
	}

	const s3List = Array.isArray(options.s3)
		? options.s3
		: options.s3
			? [options.s3]
			: [];
	for (const entry of s3List) {
		const presignOrigin = parseOrigin(entry.presignEndpoint);
		if (presignOrigin !== undefined) {
			connectSrc.add(presignOrigin);
		}
		const publicOrigin =
			entry.publicHost !== undefined
				? parseOrigin(entry.publicHost)
				: undefined;
		if (publicOrigin !== undefined) {
			connectSrc.add(publicOrigin);
			imgSrc.add(publicOrigin);
			mediaSrc.add(publicOrigin);
		} else if (presignOrigin !== undefined) {
			imgSrc.add(presignOrigin);
			mediaSrc.add(presignOrigin);
		}
	}

	const multipartList = Array.isArray(options.s3Multipart)
		? options.s3Multipart
		: options.s3Multipart
			? [options.s3Multipart]
			: [];
	for (const entry of multipartList) {
		const endpointOrigin = parseOrigin(entry.endpoint);
		if (endpointOrigin !== undefined) connectSrc.add(endpointOrigin);

		// Presigned part PUTs hit the bucket origin directly (connect-src);
		// it also serves the object unless a distinct publicHost is given.
		const bucketOrigin =
			entry.bucketHost !== undefined
				? parseOrigin(entry.bucketHost)
				: undefined;
		if (bucketOrigin !== undefined) connectSrc.add(bucketOrigin);

		const publicOrigin =
			entry.publicHost !== undefined
				? parseOrigin(entry.publicHost)
				: undefined;
		const serveOrigin = publicOrigin ?? bucketOrigin;
		if (serveOrigin !== undefined) {
			connectSrc.add(serveOrigin);
			imgSrc.add(serveOrigin);
			mediaSrc.add(serveOrigin);
		}
	}

	return Object.freeze({
		connectSrc: Object.freeze([...connectSrc]),
		imgSrc: Object.freeze([...imgSrc]),
		mediaSrc: Object.freeze([...mediaSrc]),
	});
}

function parseOrigin(value: string | URL): string | undefined {
	const raw = typeof value === "string" ? value : value.toString();
	try {
		return new URL(raw).origin;
	} catch {
		return undefined;
	}
}
