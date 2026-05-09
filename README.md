# `@anvilkit/plugin-asset-manager`

Headless asset upload plugin for Anvilkit Studio.

## What it ships

- `createAssetManagerPlugin(options)` for Studio registration and runtime upload handling.
- `uploadAsset(ctx, file)` for invoking the configured upload adapter and registering the validated result.
- `getAssetRegistry(ctx)` for reading the plugin runtime registry after `onInit`.
- `createAssetReference(id)` for producing stable `asset://<id>` references.
- `createAssetRegistry()` for storing validated asset metadata by `id`.
- `./ui` React components for a host-rendered upload button and asset browser.
- Reference upload adapters for tests and demos.

## Trust model

`UploadAdapter.url` is treated as untrusted input. Every adapter response is validated through `validateUploadResult()` before it reaches the registry or IR-shaped data, with a default allowlist of `http`, `https`, and `blob`.

## Entry points

- `@anvilkit/plugin-asset-manager` — headless runtime, validation, adapters, errors.
- `@anvilkit/plugin-asset-manager/ui` — React UI components.
- `@anvilkit/plugin-asset-manager/retry` — generic `RetryableError` + `withRetry()` (experimental).
- `@anvilkit/plugin-asset-manager/adapters/s3` — `s3PresignedAdapter` (experimental).
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
| `DATA_URL_FILE_TOO_LARGE`      | `dataUrlUploader`               |
| `DATA_URL_READ_FAILED`         | `dataUrlUploader`               |
| `UPLOAD_FAILED`                | `uploadAsset` fallback wrap     |

`AssetResolutionError.code` (raised by `IRAssetResolver`):

| Code                       | Meaning                                            |
| -------------------------- | -------------------------------------------------- |
| `ASSET_NOT_FOUND`          | The registry has no entry for the asset id.       |
| `ASSET_URL_REJECTED`       | The stored URL failed the allowlist or trust gate. |
| `ASSET_VALIDATION_FAILED`  | Catch-all for unexpected resolver failures.        |
