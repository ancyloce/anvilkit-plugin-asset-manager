import type { AssetKind, UploadResult } from "../types/types.js";

/**
 * Library-management kind inference. Used by both
 * `AssetRegistry.search` (kind filter) and `inferStudioAssetKind`
 * (sidebar projection) so a single source of truth drives both.
 */
export function inferAssetKind(entry: UploadResult): AssetKind {
  const mimeType = entry.meta?.mimeType;
  const url = entry.url;
  if (mimeType?.startsWith("image/")) return "image";
  if (mimeType?.startsWith("video/")) return "video";
  if (mimeType?.startsWith("audio/")) return "audio";
  if (
    mimeType?.startsWith("font/") ||
    /\.(?:woff2?|ttf|otf)(?:$|[?#])/i.test(url)
  ) {
    return "font";
  }
  if (mimeType === "application/pdf" || /\.pdf(?:$|[?#])/i.test(url)) {
    return "document";
  }
  return "other";
}
