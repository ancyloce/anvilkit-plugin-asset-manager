"use client";

import { Button } from "@anvilkit/ui/button";
import * as React from "react";
import { validateSelectedFile } from "../plugin.js";
import type { AssetManagerOptions, UploadResult } from "../types/types.js";
import { validateUploadResult } from "../utils/validate-upload-result.js";

export interface UploadProgressSnapshot {
  readonly completed: number;
  readonly total: number;
}

export interface UploadButtonProps extends Pick<
  AssetManagerOptions,
  | "acceptedMimeTypes"
  | "maxFileSize"
  | "uploader"
  | "dataUrlAllowlistOptIn"
  | "allowMixedScriptHostnames"
> {
  readonly onUploaded?: (asset: UploadResult) => void;
  readonly onError?: (error: unknown) => void;
  /**
   * Fires whenever the in-flight batch advances. Emitted as
   * `{ completed, total }` while a batch is running and `null` once the
   * batch settles. Used by `AssetManagerUI` to surface an aggregate bar.
   */
  readonly onProgress?: (snapshot: UploadProgressSnapshot | null) => void;
}

export function UploadButton({
  acceptedMimeTypes,
  allowMixedScriptHostnames,
  dataUrlAllowlistOptIn,
  maxFileSize,
  onError,
  onProgress,
  onUploaded,
  uploader,
}: UploadButtonProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [batch, setBatch] = React.useState<UploadProgressSnapshot | null>(null);
  const [isDragOver, setIsDragOver] = React.useState(false);
  const isUploading = batch !== null;
  // Cancels a previous in-flight batch when a new selection arrives, and
  // on unmount, so a superseded run stops uploading and stops mutating
  // this component's progress state.
  const uploadAbortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => () => uploadAbortRef.current?.abort(), []);

  const acceptAttr = React.useMemo(
    () => acceptedMimeTypes?.join(","),
    [acceptedMimeTypes],
  );

  async function processFiles(files: readonly File[]) {
    if (files.length === 0) {
      return;
    }

    // Supersede any in-flight batch — the newer selection owns the UI.
    uploadAbortRef.current?.abort();
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    const { signal } = controller;

    const total = files.length;
    setErrorMessage(null);
    const initial: UploadProgressSnapshot = { completed: 0, total };
    setBatch(initial);
    onProgress?.(initial);

    let lastError: string | null = null;

    for (let index = 0; index < files.length; index += 1) {
      if (signal.aborted) return;
      const file = files[index];
      if (!file) continue;
      try {
        validateSelectedFile(file, { acceptedMimeTypes, maxFileSize });
        const uploaded = await uploader(file, { signal });
        // A newer batch (or unmount) superseded this run mid-upload —
        // bail without touching state the newer run now owns.
        if (signal.aborted) return;
        const validated = validateUploadResult(
          {
            ...uploaded,
            meta: {
              size: file.size,
              ...(file.type ? { mimeType: file.type } : {}),
              ...(uploaded.meta ?? {}),
            },
          },
          { dataUrlAllowlistOptIn, allowMixedScriptHostnames },
        );
        onUploaded?.(validated);
      } catch (error) {
        // Cancellation is not a user-facing error.
        if (signal.aborted) return;
        lastError = error instanceof Error ? error.message : String(error);
        onError?.(error);
      } finally {
        if (!signal.aborted) {
          const next: UploadProgressSnapshot = {
            completed: index + 1,
            total,
          };
          setBatch(next);
          onProgress?.(next);
        }
      }
    }

    if (signal.aborted) return;
    if (lastError !== null) {
      setErrorMessage(lastError);
    }
    setBatch(null);
    onProgress?.(null);
  }

  async function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const list = event.currentTarget.files;
    const picked = list ? Array.from(list) : [];
    try {
      await processFiles(picked);
    } finally {
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  }

  function handleDragEnter(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer?.types?.includes("Files")) {
      setIsDragOver(true);
    }
  }

  function handleDragOver(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
  }

  function handleDragLeave(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);
  }

  async function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);
    const files = event.dataTransfer?.files
      ? Array.from(event.dataTransfer.files)
      : [];
    await processFiles(files);
  }

  const statusMessage =
    errorMessage ??
    (batch !== null
      ? `Uploading ${Math.min(batch.completed + 1, batch.total)} of ${batch.total}…`
      : "Accepted files upload through the configured adapter.");

  return (
    <div
      data-asset-manager-drop-zone
      data-drag-over={isDragOver ? "true" : undefined}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={(event) => {
        void handleDrop(event);
      }}
      tabIndex={-1}
    >
      <input
        accept={acceptAttr}
        multiple
        onChange={(event) => {
          void handleChange(event);
        }}
        ref={inputRef}
        style={{ display: "none" }}
        type="file"
      />
      <Button
        aria-label="Upload asset file"
        disabled={isUploading}
        onClick={() => {
          inputRef.current?.click();
        }}
        type="button"
        variant="outline"
      >
        {isUploading ? <UploadSpinner /> : null}
        <span>{isUploading ? "Uploading…" : "Upload asset"}</span>
      </Button>
      <p aria-live="polite" role="status">
        {statusMessage}
      </p>
    </div>
  );
}

function UploadSpinner() {
  return (
    <svg
      aria-hidden
      fill="none"
      height={14}
      style={{
        display: "inline-block",
        marginRight: 6,
        animation: "spin 1s linear infinite",
      }}
      viewBox="0 0 24 24"
      width={14}
    >
      <circle
        cx="12"
        cy="12"
        opacity="0.25"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        d="M4 12a8 8 0 0 1 8-8"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="4"
      />
    </svg>
  );
}
