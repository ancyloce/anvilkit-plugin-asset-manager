# `@anvilkit/plugin-asset-manager`

Headless asset upload plugin for Anvilkit Studio.

## What it ships

- `createAssetManagerPlugin(options)` for Studio registration and runtime upload handling.
- `createAssetRegistry()` for storing validated asset metadata by `id`.
- `./ui` React components for a host-rendered upload button and asset browser.
- Reference upload adapters for tests and demos.

## Trust model

`UploadAdapter.url` is treated as untrusted input. Every adapter response is validated through `validateUploadResult()` before it reaches the registry or IR-shaped data, with a default allowlist of `http`, `https`, and `blob`.

## Entry points

- `@anvilkit/plugin-asset-manager` — headless runtime, validation, adapters, errors.
- `@anvilkit/plugin-asset-manager/ui` — React UI components.
- `@anvilkit/plugin-asset-manager/testing` — helpers for integration tests.
