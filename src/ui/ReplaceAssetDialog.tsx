"use client";

import { Button } from "@anvilkit/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@anvilkit/ui/dialog";
import * as React from "react";

import { validateSelectedFile } from "../plugin.js";
import type { AssetManagerOptions, UploadResult } from "../types.js";

export interface ReplaceAssetDialogProps extends Pick<
  AssetManagerOptions,
  "acceptedMimeTypes" | "maxFileSize"
> {
  /** Asset to replace. `null` closes the dialog. */
  readonly asset: UploadResult | null;
  /**
   * Receives the selected file. Typically calls
   * `studioAssetSource.replace(asset.id, file)` or
   * `registry.replace(asset.id, await uploader(file))`.
   */
  readonly onConfirm: (asset: UploadResult, file: File) => void | Promise<void>;
  readonly onCancel: () => void;
}

export function ReplaceAssetDialog({
  acceptedMimeTypes,
  asset,
  maxFileSize,
  onCancel,
  onConfirm,
}: ReplaceAssetDialogProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const acceptAttr = React.useMemo(
    () => acceptedMimeTypes?.join(","),
    [acceptedMimeTypes],
  );

  // Reset state whenever the dialog reopens for a different asset.
  React.useEffect(() => {
    if (asset === null) {
      setSelectedFile(null);
      setError(null);
      setBusy(false);
    }
  }, [asset]);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    try {
      validateSelectedFile(file, { acceptedMimeTypes, maxFileSize });
      setError(null);
      setSelectedFile(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSelectedFile(null);
    }
  }

  async function handleConfirm() {
    if (asset === null || selectedFile === null || busy) {
      return;
    }
    setBusy(true);
    try {
      await onConfirm(asset, selectedFile);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && !busy) {
      onCancel();
    }
  }

  const open = asset !== null;
  const label = asset?.name ?? asset?.id ?? "";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Replace asset?</DialogTitle>
          <DialogDescription>
            {label
              ? `Pick a file to replace ${label} with. Existing asset:// references will resolve to the new bytes.`
              : "Pick a file to replace this asset with."}
          </DialogDescription>
        </DialogHeader>
        <input
          aria-label="Replacement file"
          data-testid="replace-asset-file-input"
          hidden
          onChange={handleFileChange}
          ref={inputRef}
          type="file"
          {...(acceptAttr ? { accept: acceptAttr } : {})}
        />
        <div data-asset-manager-replace-state>
          <Button
            type="button"
            variant="outline"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
          >
            {selectedFile ? "Choose a different file" : "Choose file"}
          </Button>
          <p aria-live="polite" role="status">
            {selectedFile
              ? `Selected: ${selectedFile.name}`
              : "No file selected."}
          </p>
          {error ? (
            <p data-asset-manager-replace-error role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={busy || asset === null || selectedFile === null}
          >
            {busy ? "Replacing…" : "Replace"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
