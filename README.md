# @anvilkit/plugin-asset-manager

> **Alpha (`0.1.6`).** Public surface may still shift before `v1.0`. Bundle budgets enforced in CI: headless ≤ 6 KB gzip, UI subpath ≤ 12 KB gzip.

Headless asset manager plugin for Anvilkit Studio. The host provides the upload backend; the plugin handles validation, registration, search, IR-time resolution, CSP guidance, and (optionally) a React UI for the upload + browse experience. Designed for pluggable production backends (S3, GCS, custom HTTP) with strict trust-boundary enforcement on every adapter response.

## Installation

```bash
pnpm add @anvilkit/plugin-asset-manager @anvilkit/core react react-dom @puckeditor/core
```

Non-optional peers: `react >=19.0.0`, `react-dom >=19.0.0`, `@puckeditor/core ^0.21.2`.

Subpath imports:

- `@anvilkit/plugin-asset-manager` — plugin factory, validation, adapters, CSP advisor, errors.
- `@anvilkit/plugin-asset-manager/ui` — React UI components.
- `@anvilkit/plugin-asset-manager/retry` — generic `RetryableError` + `withRetry()`.
- `@anvilkit/plugin-asset-manager/adapters/s3` — production `s3PresignedAdapter`.
- `@anvilkit/plugin-asset-manager/testing` — fixtures for downstream plugin tests.

## Quickstart

```ts
import {
  createAssetManagerPlugin,
  dataUrlUploader,
} from "@anvilkit/plugin-asset-manager";
import { Studio } from "@anvilkit/core";

const assetManager = createAssetManagerPlugin({
  uploader: dataUrlUploader(),
});

<Studio puckConfig={puckConfig} plugins={[assetManager]} />;
```

`dataUrlUploader` is dev-only — files are converted to in-memory `data:` URLs (1 MB cap by default). For production, swap in `s3PresignedAdapter` or a custom `UploadAdapter`.

## Core features

- **Pluggable upload adapters** — `dataUrlUploader`, `inMemoryUploader`, and `s3PresignedAdapter` ship in-box; custom adapters implement the `UploadAdapter` function signature.
- **Strict trust model** — every adapter response is validated through `validateUploadResult`: scheme allowlist, path-traversal guard, IDN homoglyph guard. `javascript:` / `vbscript:` are hard-blocked. `data:` is opt-in.
- **In-memory asset registry** — search (`query` / `kinds` / `tags`), opaque cursor pagination, auto-derived tags, rename / retag / replace / delete.
- **IR-time resolution** — `createIRAssetResolver` + `resolveAssets` turn `asset://<id>` references into validated URLs at export / render time.
- **CSP advisor** — `getRequiredCsp` computes the minimum `connect-src` / `img-src` / `media-src` directives the configured adapters need.
- **Production-ready S3 adapter** — `s3PresignedAdapter` POST-then-PUT with exponential-backoff retry on 5xx + network failures (4xx fails fast).
- **Optional React UI** — `UploadButton`, `AssetBrowser`, `AssetCommandPalette`, `MetadataPanel`, `ReplaceAssetDialog`, `DeleteAssetDialog`, and the composite `AssetManagerUI`.
- **Batch upload control** — `StudioAssetSource.upload(files)` honors `maxConcurrentUploads` (default 3) and `AbortSignal`.

## API reference

### Plugin factory

```ts
function createAssetManagerPlugin(options: AssetManagerOptions): StudioPlugin;
```

| Field                       | Type                                           | Default    | Purpose                                                                   |
| --------------------------- | ---------------------------------------------- | ---------- | ------------------------------------------------------------------------- |
| `uploader`                  | `UploadAdapter`                                | _required_ | Upload backend.                                                           |
| `maxFileSize`               | `number`                                       | none       | Bytes. Enforced before the adapter runs.                                  |
| `acceptedMimeTypes`         | `readonly string[]`                            | none       | Allowlist. Enforced before the adapter runs.                              |
| `dataUrlAllowlistOptIn`     | `boolean`                                      | `false`    | When `true`, `data:` URLs are valid output.                               |
| `allowMixedScriptHostnames` | `boolean`                                      | `false`    | When `true`, hostnames mixing Latin with a confusable script are allowed. |
| `getThumbnail`              | `(entry: UploadResult) => string \| undefined` | none       | Optional override for the displayed thumbnail.                            |

### Imperative API on the plugin context

| Function               | Signature                                       | Purpose                                                    |
| ---------------------- | ----------------------------------------------- | ---------------------------------------------------------- |
| `uploadAsset`          | `(ctx, file, signal?) => Promise<UploadResult>` | Validate file → run uploader → validate result → register. |
| `getAssetRegistry`     | `(ctx) => AssetRegistry \| undefined`           | Read the runtime registry after `onInit`.                  |
| `createAssetReference` | `(id) => string`                                | Produce a stable `asset://<id>` reference for IR.          |

### `UploadAdapter`

```ts
type UploadAdapter = (
  file: File,
  options?: UploadAdapterOptions, // { signal?: AbortSignal }
) => Promise<UploadResult>;

interface UploadResult {
  readonly url: string;
  readonly id: string;
  readonly name?: string;
  readonly meta?: AssetMeta; // { size?, mimeType?, width?, height? }
  readonly tags?: readonly string[];
}
```

### Reference adapters

| Adapter                    | Use case   | Notes                                                                                                |
| -------------------------- | ---------- | ---------------------------------------------------------------------------------------------------- |
| `dataUrlUploader(opts?)`   | Dev, demos | `maxBytes` default 1 MB. Extracts image dimensions.                                                  |
| `inMemoryUploader()`       | Tests      | Stores files in memory with `blob:` URLs.                                                            |
| `s3PresignedAdapter(opts)` | Production | POST `{ name, type, size }` to `presignEndpoint`; PUT file to returned `url`. Retries 5xx + network. |

`s3PresignedAdapter` options:

| Field             | Default               | Purpose                                                        |
| ----------------- | --------------------- | -------------------------------------------------------------- |
| `presignEndpoint` | _required_            | URL that returns `{ url, publicUrl?, headers?, id? }`.         |
| `fetch`           | `globalThis.fetch`    | Injectable fetch implementation (for tests / instrumentation). |
| `region`          | none                  | Recorded for logs only; not validated.                         |
| `retry`           | `{ maxRetries: 3 }`   | Forwarded to `withRetry()` for both phases.                    |
| `signal`          | none                  | Aborts in-flight presign + PUT + any retry sleep.              |
| `headers`         | none                  | Extra headers on the presign POST (e.g., auth).                |
| `idGenerator`     | `crypto.randomUUID()` | Asset id override.                                             |

### `AssetRegistry`

```ts
interface AssetRegistry {
  register(asset: UploadResult): UploadResult;
  get(id: string): UploadResult | undefined;
  list(): readonly UploadResult[];
  delete(id: string): boolean;
  rename(id: string, name: string): UploadResult | undefined;
  replace(id: string, next: UploadResult): UploadResult | undefined;
  setTags(id: string, tags: readonly string[]): UploadResult | undefined;
  search(options?: AssetSearchOptions): AssetSearchPage;
  subscribe(listener: AssetRegistryListener): () => void;
}

interface AssetSearchOptions {
  readonly query?: string; // matches id, name, MIME prefix, tags (case-insensitive)
  readonly kinds?: readonly AssetKind[];
  readonly tags?: readonly string[]; // AND semantics
  readonly cursor?: string;
  readonly limit?: number;
}

interface AssetSearchPage {
  readonly items: readonly UploadResult[];
  readonly total: number;
  readonly nextCursor: string | undefined;
}
```

`AssetKind` is one of `"image" | "video" | "audio" | "font" | "document" | "other"` — inferred from MIME via `inferAssetKind(mimeType)`.

### Sidebar source bridge

```ts
function createStudioAssetSource(
  options: CreateStudioAssetSourceOptions,
): StudioAssetSource;

interface CreateStudioAssetSourceOptions {
  readonly registry: AssetRegistry;
  readonly upload: (
    file: File,
    options?: UploadAdapterOptions,
  ) => Promise<UploadResult>;
  readonly getThumbnail?: (entry: UploadResult) => string | undefined;
  readonly maxConcurrentUploads?: number; // default 3
}
```

Sidebar consumers can also call `inferStudioAssetKind(entry)` directly.

### IR resolution

| Export                  | Signature                                                 | Purpose                                                  |
| ----------------------- | --------------------------------------------------------- | -------------------------------------------------------- |
| `createIRAssetResolver` | `(opts: CreateIRAssetResolverOptions) => IRAssetResolver` | Resolves `asset://<id>` references against the registry. |
| `resolveAssets`         | `(ir: PageIR, resolver) => PageIR`                        | Walks the IR tree and rewrites asset references.         |

```ts
interface CreateIRAssetResolverOptions {
  readonly registry: AssetRegistry;
  readonly dataUrlAllowlistOptIn?: boolean;
  readonly allowMixedScriptHostnames?: boolean;
}
```

### Validation & security

```ts
function validateUploadResult(
  result: UploadResult,
  options?: ValidateUploadResultOptions,
): UploadResult;
```

Throws `AssetValidationError` on bad input. Always enforces:

- Default scheme set: `http`, `https`, `blob`.
- Hard-blocks: `javascript:`, `vbscript:`.
- Path traversal: `../` and percent-encoded variants (`%2e%2e/`, `%2e%2e%2f`) rejected on `http`/`https`/`blob` URLs.
- IDN homoglyph: hostnames mixing Latin with Cyrillic or Greek are rejected unless `allowMixedScriptHostnames: true`. Single-script IDN hosts (`münchen.de`, `日本.jp`, `россия.рф`) are always allowed.

### CSP advisor

```ts
function getRequiredCsp(options: RequiredCspOptions): RequiredCsp;
```

| Adapter              | `connect-src`                 | `img-src`               | `media-src`             |
| -------------------- | ----------------------------- | ----------------------- | ----------------------- |
| `dataUrlUploader`    | _(none)_                      | `data:`                 | `data:`                 |
| `inMemoryUploader`   | _(none)_                      | `blob:`                 | `blob:`                 |
| `s3PresignedAdapter` | presign origin + `publicHost` | `publicHost` ?? presign | `publicHost` ?? presign |

### React UI (`./ui`)

| Component             | Key props                                     |
| --------------------- | --------------------------------------------- |
| `UploadButton`        | `{ onUpload, onProgress?, disabled? }`        |
| `AssetBrowser`        | `{ registry, onSelect, maxWidth? }`           |
| `AssetCommandPalette` | `{ registry, onSelect }`                      |
| `MetadataPanel`       | `{ asset, registry, onClose }`                |
| `ReplaceAssetDialog`  | `{ asset, onReplace, onCancel }`              |
| `DeleteAssetDialog`   | `{ asset, onDelete, onCancel }`               |
| `AssetManagerUI`      | `{ registry, plugin, maxWidth? }` (composite) |

`UploadProgressSnapshot` is `{ inFlight: number; completed: number }`.

### Retry helpers (`./retry`)

```ts
class RetryableError extends Error {
  readonly retryAfterMs?: number;
}

interface RetryOptions {
  readonly maxRetries?: number; // default 3
  readonly baseDelayMs?: number; // default 250
  readonly maxDelayMs?: number; // default 8000
  readonly signal?: AbortSignal;
  readonly jitter?: () => number; // default Math.random
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options?: RetryOptions,
): Promise<T>;
```

Full-jitter exponential backoff; the optional `retryAfterMs` on a `RetryableError` overrides the computed delay (use this when the server returned a `Retry-After` header).

### Errors

`AssetValidationError.code`:

| Code                           | Source                      |
| ------------------------------ | --------------------------- |
| `FILE_TOO_LARGE`               | pre-upload file validation  |
| `UNSUPPORTED_MIME_TYPE`        | pre-upload file validation  |
| `INVALID_UPLOAD_ID`            | `validateUploadResult`      |
| `EMPTY_UPLOAD_URL`             | `validateUploadResult`      |
| `UNSCHEMED_UPLOAD_URL`         | `validateUploadResult`      |
| `DISALLOWED_UPLOAD_URL_SCHEME` | `validateUploadResult`      |
| `PATH_TRAVERSAL_URL`           | `validateUploadResult`      |
| `MIXED_SCRIPT_HOSTNAME`        | `validateUploadResult`      |
| `DATA_URL_FILE_TOO_LARGE`      | `dataUrlUploader`           |
| `DATA_URL_READ_FAILED`         | `dataUrlUploader`           |
| `UPLOAD_FAILED`                | `uploadAsset` fallback wrap |

`AssetResolutionError.code`:

| Code                      | Meaning                                            |
| ------------------------- | -------------------------------------------------- |
| `ASSET_NOT_FOUND`         | The registry has no entry for the asset id.        |
| `ASSET_URL_REJECTED`      | The stored URL failed the allowlist or trust gate. |
| `ASSET_VALIDATION_FAILED` | Catch-all for unexpected resolver failures.        |

## Usage examples

### Data-URL adapter for local development

```ts
createAssetManagerPlugin({
  uploader: dataUrlUploader({ maxBytes: 2_000_000 }),
  dataUrlAllowlistOptIn: true,
});
```

### Production S3 wiring

```ts
import {
  createAssetManagerPlugin,
  getRequiredCsp,
} from "@anvilkit/plugin-asset-manager";
import { s3PresignedAdapter } from "@anvilkit/plugin-asset-manager/adapters/s3";

const uploader = s3PresignedAdapter({
  presignEndpoint: "/api/assets/sign",
  headers: { Authorization: `Bearer ${apiKey}` },
  retry: { maxRetries: 3 },
});

const plugin = createAssetManagerPlugin({ uploader });

const csp = getRequiredCsp({
  s3: {
    presignEndpoint: "/api/assets/sign",
    publicHost: "https://cdn.example.com",
  },
});

response.setHeader(
  "Content-Security-Policy",
  [
    `default-src 'self'`,
    `connect-src 'self' ${csp.connectSrc.join(" ")}`,
    `img-src 'self' ${csp.imgSrc.join(" ")}`,
    `media-src 'self' ${csp.mediaSrc.join(" ")}`,
  ].join("; "),
);
```

### Custom upload adapter

```ts
import type { UploadAdapter } from "@anvilkit/plugin-asset-manager";
import {
  RetryableError,
  withRetry,
} from "@anvilkit/plugin-asset-manager/retry";

const myCdnUploader: UploadAdapter = async (file, { signal } = {}) =>
  withRetry(
    async () => {
      const response = await fetch("/api/cdn", {
        method: "POST",
        body: file,
        headers: { "Content-Type": file.type, "X-Filename": file.name },
        signal,
      });
      if (response.status >= 500) {
        throw new RetryableError(`CDN ${response.status}`);
      }
      if (!response.ok) {
        throw new Error(`CDN ${response.status}: ${await response.text()}`);
      }
      const { url, id } = await response.json();
      return {
        id,
        url,
        name: file.name,
        meta: { size: file.size, mimeType: file.type },
      };
    },
    { signal, maxRetries: 2 },
  );
```

### Resolving assets at export time

```ts
import {
  createAssetRegistry,
  createIRAssetResolver,
  resolveAssets,
} from "@anvilkit/plugin-asset-manager";

const registry = createAssetRegistry();
registry.register({
  id: "logo",
  url: "https://cdn.example.com/logo.svg",
  name: "logo.svg",
});

const resolver = createIRAssetResolver({ registry });
const resolved = resolveAssets(ir, resolver);
// `asset://logo` references inside `ir` are now full URLs.
```

## Notes & FAQ

### Trust model is strict by default

`UploadAdapter.url` is treated as untrusted input. Default scheme set is `http`, `https`, `blob`. `data:` is **off by default** — enable it with `dataUrlAllowlistOptIn: true`. Mixed-script hostnames are rejected unless `allowMixedScriptHostnames: true`. The plugin will not let an adapter smuggle a `javascript:` URL into the registry under any configuration.

### Migrating from the alpha `urlAllowlist` field

The alpha-era `urlAllowlist?: readonly string[]` field is removed.

| Alpha                                             | Replacement                                                                         |
| ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `urlAllowlist: ["http", "https", "blob"]`         | _(default — drop the field)_                                                        |
| `urlAllowlist: ["http", "https", "blob", "data"]` | `dataUrlAllowlistOptIn: true`                                                       |
| `urlAllowlist: ["http", "https", "blob", "ftp"]`  | _not supported — wrap `validateUploadResult` and call `registry.register` directly_ |

Rationale: every scheme allowed at the boundary needs its own CSP / sanitization story. Typed flags force that decision to be explicit.

### Batch upload behavior

`StudioAssetSource.upload(files)` runs up to `maxConcurrentUploads` (default 3) uploads in parallel. Per-file failures surface via the listener as `error` envelopes; the returned promise resolves with the successful subset and **does not throw**. Hosts that need fail-fast semantics can pass `maxConcurrentUploads: 1`. `AbortError`s from the adapter abort the whole batch — pending files are not scheduled.

### Persistence is host-owned

The plugin keeps registry state in-memory per Studio mount. If you need cross-session asset reuse, the host stores `publicUrl`s server-side and re-seeds the registry on boot via `registry.register(...)`.

### S3 adapter never logs file contents

Only `name`, `size`, and `mimeType` are considered safe to log. If your host endpoint is not S3-compatible (no overwrite semantics), pass `retry: { maxRetries: 0 }` to disable retry and avoid the small chance of a duplicate upload.

### Production checklist

1. **Pick the right adapter.** `dataUrlUploader` is dev-only. `s3PresignedAdapter` is the production default; wire it to your presign endpoint and set `retry: { maxRetries: 3 }`.
2. **Set the trust flags explicitly.** Decide whether your host needs `dataUrlAllowlistOptIn: true` (only if your flow embeds `data:` URLs end-to-end). Leave `allowMixedScriptHostnames` off unless you have a documented business need.
3. **Wire CSP.** Call `getRequiredCsp(...)` and merge the result into your `connect-src` / `img-src` / `media-src` builder. Re-run when you add or remove an adapter.
4. **Choose a persistence story.** Plugin state is in-memory; host stores `publicUrl`s server-side and re-seeds on boot.
5. **Monitor.** Subscribe to `asset-manager:error` event bus envelopes for upload failures, and log `AssetResolutionError.code` from your export pipeline so `ASSET_NOT_FOUND` / `ASSET_URL_REJECTED` / `ASSET_VALIDATION_FAILED` get separate alerts.
6. **Lock down the bundle.** `.size-limit.json` keeps the headless entry under 6 KB gzip and the UI subpath under 12 KB. CI gates both.

### Optional UI is a separate entry

Importing from `@anvilkit/plugin-asset-manager` never pulls the `/ui` components. Hosts that ship their own browser/upload UI pay no UI rendering cost.
