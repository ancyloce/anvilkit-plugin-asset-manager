# `@anvilkit/plugin-asset-manager`

Headless asset upload plugin for Anvilkit Studio.

## What it ships

- `createAssetManagerPlugin(options)` for Studio registration and runtime upload handling.
- `uploadAsset(ctx, file)` for invoking the configured upload adapter and registering the validated result.
- `getAssetRegistry(ctx)` for reading the plugin runtime registry after `onInit`.
- `createAssetReference(id)` for producing stable `asset://<id>` references.
- `createAssetRegistry()` for storing validated asset metadata, with `search`, `setTags`, and pagination.
- `getRequiredCsp(opts)` for computing the minimum `connect-src` / `img-src` / `media-src` directives the configured adapters need.
- `./ui` React components for a host-rendered upload button, asset browser (with search + filter chips), command palette, and metadata editor.
- Reference upload adapters for tests and demos.

## Library management (search, tags, pagination)

`AssetRegistry.search(options)` returns a paginated, filtered slice of the registry:

```ts
const page = registry.search({
  query: "hero",          // matches id, name, MIME prefix, and tags (case-insensitive)
  kinds: ["image"],       // filter by inferred kind (image/video/audio/font/document/other)
  tags: ["brand"],        // require all listed tags (AND semantics)
  limit: 20,
  cursor: undefined,      // opaque; pass `page.nextCursor` to advance
});
```

Tags are auto-derived on every upload (kind + up to two filename tokens, capped at 3) and can be edited via `registry.setTags(id, tags)` or the `MetadataPanel` UI. Host-supplied `UploadResult.tags` are preserved verbatim.

`StudioAssetSource.listPaginated(query)` is the sidebar-facing pagination contract — remote sources can implement it to push search and pagination to the server. Sidebar consumers fall back to `list()` when omitted.

`StudioAssetSource.subscribeUploads(listener)` is a streaming channel that fans `progress` / `done` / `error` envelopes out to every subscriber alongside the inline upload listener.

## Trust model

`UploadAdapter.url` is treated as untrusted input. Every adapter response is validated through `validateUploadResult()` before it reaches the registry or IR-shaped data.

The default scheme set is **always** `http`, `https`, and `blob`. `javascript:` and `vbscript:` are hard-blocked under all configurations. `data:` is **off by default** in v1.0 — enable it explicitly per plugin instance:

```ts
createAssetManagerPlugin({
  uploader: dataUrlUploader(),
  dataUrlAllowlistOptIn: true,
});
```

Two further hardening checks run at validation time:

- **Path traversal.** `../` and percent-encoded variants (`%2e%2e/`, `%2e%2e%2f`) are rejected on `http`/`https`/`blob` URLs.
- **IDN homoglyph.** Hostnames mixing Latin with a visually confusable script (Cyrillic or Greek) are rejected. Single-script IDN hosts such as `münchen.de`, `日本.jp`, or `россия.рф` are always allowed. Hosts that legitimately need this combination can pass `allowMixedScriptHostnames: true`.

### Migration from `urlAllowlist` (alpha → 1.0)

The alpha-era `urlAllowlist?: readonly string[]` field is removed in v1.0. Replace any existing usage with the typed flags:

| Alpha                                          | v1.0                                |
| ---------------------------------------------- | ----------------------------------- |
| `urlAllowlist: ["http", "https", "blob"]`      | _(default — drop the field)_        |
| `urlAllowlist: ["http", "https", "blob", "data"]` | `dataUrlAllowlistOptIn: true`    |
| `urlAllowlist: ["http", "https", "blob", "ftp"]`  | _not supported — write a custom resolver wrapper_ |

If your host needs an exotic scheme (`s3:`, `ipfs:`, `gs:`), wrap `validateUploadResult` and pass the result to `registry.register` directly. The rationale for dropping arbitrary scheme strings: every scheme allowed at the boundary needs its own CSP / sanitization story — typed flags force that decision to be explicit.

## Content Security Policy

`getRequiredCsp(options)` computes the minimum CSP directives the configured adapters need. Call it once at boot and merge the result into your existing CSP builder:

```ts
import { getRequiredCsp } from "@anvilkit/plugin-asset-manager";

const csp = getRequiredCsp({
  dataUrl: true,
  s3: { presignEndpoint: "https://uploads.example.com/sign" },
});
// csp.connectSrc → ["https://uploads.example.com"]
// csp.imgSrc     → ["data:", "https://uploads.example.com"]
// csp.mediaSrc   → ["data:", "https://uploads.example.com"]
```

| Adapter                | `connect-src`                | `img-src`                    | `media-src`                  |
| ---------------------- | ---------------------------- | ---------------------------- | ---------------------------- |
| `dataUrlUploader`      | _(none)_                     | `data:`                      | `data:`                      |
| `inMemoryUploader`     | _(none)_                     | `blob:`                      | `blob:`                      |
| `s3PresignedAdapter`   | presign origin + `publicHost`| `publicHost` ?? presign      | `publicHost` ?? presign      |

If your `publicUrl` returned by the presign service points at a different origin than the presign endpoint itself, pass `s3: { presignEndpoint, publicHost }` so the advisor can split the directives correctly.

## Entry points

- `@anvilkit/plugin-asset-manager` — headless runtime, validation, adapters, errors, CSP advisor.
- `@anvilkit/plugin-asset-manager/ui` — React UI components.
- `@anvilkit/plugin-asset-manager/retry` — generic `RetryableError` + `withRetry()`.
- `@anvilkit/plugin-asset-manager/adapters/s3` — `s3PresignedAdapter`.
- `@anvilkit/plugin-asset-manager/testing` — fixtures for downstream plugin tests.

## Batch upload behaviour

`StudioAssetSource.upload(files)` runs up to `MAX_CONCURRENT_UPLOADS` (default 3) uploads in parallel. Per-file failures surface via the listener as `error` envelopes; the returned promise resolves with the successful subset and **does not throw**. Hosts that need fail-fast semantics can pass `maxConcurrentUploads: 1`.

`AbortError`s thrown from the adapter abort the whole batch — pending files are not scheduled.

## S3 presigned adapter

```ts
import { s3PresignedAdapter } from "@anvilkit/plugin-asset-manager/adapters/s3";
import { createAssetManagerPlugin } from "@anvilkit/plugin-asset-manager";

createAssetManagerPlugin({
  uploader: s3PresignedAdapter({
    presignEndpoint: "/api/sign",
    retry: { maxRetries: 3 },
  }),
});
```

The adapter POSTs `{ name, type, size }` to `presignEndpoint`, expects `{ url, publicUrl?, headers?, id? }` back, then PUTs the file to `url`. Both phases retry on 5xx and network errors with exponential backoff. 4xx responses fail without retry.

If the host endpoint is **not** S3-compatible (e.g. a custom uploader without overwrite semantics), pass `retry: { maxRetries: 0 }` to disable retry and avoid the small chance of a duplicate upload.

The adapter never logs file contents — only `name`, `size`, and `mimeType`.

## Production checklist

Before mounting in a real Studio host:

1. **Pick the right adapter.** `dataUrlUploader` is dev-only (size cap, in-memory). `s3PresignedAdapter` is the production default; wire it to your presign endpoint and set `retry: { maxRetries: 3 }`.
2. **Set the trust flags explicitly.** Decide whether your host needs `dataUrlAllowlistOptIn: true` (only if your editor flow embeds `data:` URLs end-to-end). Leave `allowMixedScriptHostnames` off unless you have a documented business need.
3. **Wire CSP.** Call `getRequiredCsp(...)` and merge the result into your `connect-src` / `img-src` / `media-src` builder. Re-run when you add or remove an adapter.
4. **Choose a persistence story.** The plugin keeps state in-memory per Studio mount. If you need cross-session asset reuse, the host stores `publicUrl`s server-side and re-seeds the registry on boot via `registry.register`.
5. **Decide on monitoring.** Subscribe to the `asset-manager:error` event bus envelopes (`code`, `message`) for upload failures, and log `AssetResolutionError.code` from your export pipeline so `ASSET_NOT_FOUND` / `ASSET_URL_REJECTED` / `ASSET_VALIDATION_FAILED` get separate alerts.
6. **Lock down the bundle.** Consult `.size-limit.json` — the headless entry stays under 6 KB gzip; the UI subpath stays under 12 KB. CI gates both.

## Error codes

`AssetValidationError.code` (raised by upload + validation):

| Code                           | Source                          |
| ------------------------------ | ------------------------------- |
| `FILE_TOO_LARGE`               | `validateSelectedFile`          |
| `UNSUPPORTED_MIME_TYPE`        | `validateSelectedFile`          |
| `INVALID_UPLOAD_ID`            | `validateUploadResult`          |
| `EMPTY_UPLOAD_URL`             | `validateUploadResult`          |
| `UNSCHEMED_UPLOAD_URL`         | `validateUploadResult`          |
| `DISALLOWED_UPLOAD_URL_SCHEME` | `validateUploadResult`          |
| `PATH_TRAVERSAL_URL`           | `validateUploadResult`          |
| `MIXED_SCRIPT_HOSTNAME`        | `validateUploadResult`          |
| `DATA_URL_FILE_TOO_LARGE`      | `dataUrlUploader`               |
| `DATA_URL_READ_FAILED`         | `dataUrlUploader`               |
| `UPLOAD_FAILED`                | `uploadAsset` fallback wrap     |

`AssetResolutionError.code` (raised by `IRAssetResolver`):

| Code                       | Meaning                                            |
| -------------------------- | -------------------------------------------------- |
| `ASSET_NOT_FOUND`          | The registry has no entry for the asset id.       |
| `ASSET_URL_REJECTED`       | The stored URL failed the allowlist or trust gate. |
| `ASSET_VALIDATION_FAILED`  | Catch-all for unexpected resolver failures.        |
