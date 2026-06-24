/**
 * @file Magic-byte file-type sniffer (PRD 0004 — review #5 residual).
 *
 * Browser `File.type` is host-set and often empty or spoofable, so the MIME /
 * extension allowlists in `validateSelectedFile` can be lied to. This detects a
 * file's REAL type from its leading bytes (a small signature table covering the
 * common image / video / audio / document formats) so the upload pipeline can
 * reject content that contradicts its declared type.
 *
 * Lazy-loaded (imported only when `sniffContent` is enabled) so the signature
 * table never enters the eager headless entry.
 *
 * @experimental Public surface may change before v1.0.
 */

interface SignaturePart {
	readonly offset: number;
	readonly bytes: readonly number[];
}

interface Signature {
	readonly mime: string;
	/** All parts must match for the signature to apply. */
	readonly parts: readonly SignaturePart[];
}

const ascii = (text: string): number[] =>
	Array.from(text, (ch) => ch.charCodeAt(0));

// Order matters: more specific signatures that share a marker with a broader
// one come FIRST (e.g. AVIF before MP4 — both carry the `ftyp` box at offset 4).
const SIGNATURES: readonly Signature[] = [
	{
		// Full 8-byte PNG signature (not just the first 4) to minimise collisions.
		mime: "image/png",
		parts: [
			{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
		],
	},
	{ mime: "image/jpeg", parts: [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }] },
	{ mime: "image/gif", parts: [{ offset: 0, bytes: ascii("GIF8") }] },
	{ mime: "image/bmp", parts: [{ offset: 0, bytes: ascii("BM") }] },
	{
		mime: "image/webp",
		parts: [
			{ offset: 0, bytes: ascii("RIFF") },
			{ offset: 8, bytes: ascii("WEBP") },
		],
	},
	{
		mime: "audio/wav",
		parts: [
			{ offset: 0, bytes: ascii("RIFF") },
			{ offset: 8, bytes: ascii("WAVE") },
		],
	},
	{
		mime: "video/webm",
		parts: [{ offset: 0, bytes: [0x1a, 0x45, 0xdf, 0xa3] }],
	},
	{ mime: "audio/ogg", parts: [{ offset: 0, bytes: ascii("OggS") }] },
	// MP3 only via the ID3 tag — the raw 0xFFFB frame-sync is too broad and would
	// false-positive (wrongly rejecting unrelated files when used for validation);
	// a frame-only MP3 simply reads as "unknown" and is allowed through.
	{ mime: "audio/mpeg", parts: [{ offset: 0, bytes: ascii("ID3") }] },
	{ mime: "application/pdf", parts: [{ offset: 0, bytes: ascii("%PDF") }] },
];

// ISO base-media (`ftyp`) files all share the same box marker, so the concrete
// type comes from the major brand at offset 8. An UNKNOWN brand returns
// `undefined` (→ "unknown", not a forced `video/mp4`) so e.g. HEIC or MOV files
// aren't mislabelled and falsely rejected.
const FTYP_BRAND_MIME: Readonly<Record<string, string>> = {
	avif: "image/avif",
	avis: "image/avif",
	heic: "image/heic",
	heix: "image/heic",
	heim: "image/heic",
	heis: "image/heic",
	mif1: "image/heic",
	isom: "video/mp4",
	iso2: "video/mp4",
	mp41: "video/mp4",
	mp42: "video/mp4",
	avc1: "video/mp4",
	dash: "video/mp4",
	"qt  ": "video/quicktime",
};

const FTYP = ascii("ftyp");

/** Number of leading bytes the table needs (max offset + part length). */
export const SNIFF_BYTE_COUNT = 16;

/**
 * Detect a MIME type from a file's leading bytes, or `undefined` when no known
 * signature matches (many valid types — SVG, plain text, etc. — have no fixed
 * magic bytes, so the caller must treat `undefined` as "unknown", not "bad").
 */
export function detectMimeFromBytes(bytes: Uint8Array): string | undefined {
	// ISO base-media: branch by brand rather than blanket-labelling as mp4.
	if (matchesAt(bytes, { offset: 4, bytes: FTYP })) {
		const brand = readAscii(bytes, 8, 4);
		return brand !== undefined ? FTYP_BRAND_MIME[brand] : undefined;
	}
	for (const signature of SIGNATURES) {
		if (signature.parts.every((part) => matchesAt(bytes, part))) {
			return signature.mime;
		}
	}
	return undefined;
}

function readAscii(
	bytes: Uint8Array,
	offset: number,
	length: number,
): string | undefined {
	if (offset + length > bytes.length) return undefined;
	let out = "";
	for (let i = 0; i < length; i += 1) {
		out += String.fromCharCode(bytes[offset + i] as number);
	}
	return out;
}

function matchesAt(bytes: Uint8Array, part: SignaturePart): boolean {
	if (part.offset + part.bytes.length > bytes.length) return false;
	for (let i = 0; i < part.bytes.length; i += 1) {
		if (bytes[part.offset + i] !== part.bytes[i]) return false;
	}
	return true;
}

/** Read a file's leading bytes and detect its type (see {@link detectMimeFromBytes}). */
export async function sniffFileMime(file: File): Promise<string | undefined> {
	if (typeof file.slice !== "function") return undefined;
	const buffer = await file.slice(0, SNIFF_BYTE_COUNT).arrayBuffer();
	return detectMimeFromBytes(new Uint8Array(buffer));
}
