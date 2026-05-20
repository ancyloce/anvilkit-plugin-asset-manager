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
import { Input } from "@anvilkit/ui/input";
import * as React from "react";

import type { UploadResult } from "../types.js";

export interface MetadataPanelProps {
  /**
   * Asset whose metadata is being edited. When `null`, the panel is
   * closed. Setting this opens it; the host clears it on cancel or
   * after `onConfirm` resolves.
   */
  readonly asset: UploadResult | null;
  /**
   * Save handler. Receives the original asset plus the new name and
   * tag set. May return a Promise to keep the Save button busy until
   * the underlying registry mutation settles.
   */
  readonly onConfirm: (
    asset: UploadResult,
    next: { readonly name: string; readonly tags: readonly string[] },
  ) => void | Promise<void>;
  readonly onCancel: () => void;
}

export function MetadataPanel({
  asset,
  onCancel,
  onConfirm,
}: MetadataPanelProps) {
  const [name, setName] = React.useState("");
  const [tagInput, setTagInput] = React.useState("");
  const [tags, setTags] = React.useState<readonly string[]>([]);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (asset === null) {
      return;
    }
    setName(asset.name ?? "");
    setTags(asset.tags ?? []);
    setTagInput("");
    setBusy(false);
  }, [asset]);

  function commitTagInput(): readonly string[] {
    const next = tagInput.trim().toLowerCase();
    if (next === "") return tags;
    if (tags.includes(next)) {
      setTagInput("");
      return tags;
    }
    const merged = [...tags, next];
    setTags(merged);
    setTagInput("");
    return merged;
  }

  function removeTag(value: string) {
    setTags((current) => current.filter((entry) => entry !== value));
  }

  function handleTagKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commitTagInput();
    }
  }

  async function handleConfirm() {
    if (asset === null || busy) {
      return;
    }
    const finalTags = tagInput.trim() === "" ? tags : commitTagInput();
    setBusy(true);
    try {
      await onConfirm(asset, { name: name.trim(), tags: finalTags });
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
  const mimeType = asset?.meta?.mimeType;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit asset</DialogTitle>
          <DialogDescription>
            {asset?.id}
            {mimeType ? ` (${mimeType})` : ""}
          </DialogDescription>
        </DialogHeader>
        <div data-asset-manager-metadata>
          <label htmlFor="asset-metadata-name">Name</label>
          <Input
            id="asset-metadata-name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
            placeholder={asset?.id ?? ""}
            disabled={busy}
          />
          <div data-asset-manager-tag-editor>
            <label htmlFor="asset-metadata-tag-input">Tags</label>
            <ul aria-label="Current tags" role="list">
              {tags.map((tag) => (
                <li key={tag}>
                  <span>{tag}</span>
                  <button
                    aria-label={`Remove tag ${tag}`}
                    data-asset-action="remove-tag"
                    disabled={busy}
                    onClick={() => {
                      removeTag(tag);
                    }}
                    type="button"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <Input
              id="asset-metadata-tag-input"
              value={tagInput}
              onChange={(event) => {
                setTagInput(event.target.value);
              }}
              onKeyDown={handleTagKeyDown}
              placeholder="Add a tag and press Enter"
              disabled={busy}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={busy}
            onClick={onCancel}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            disabled={busy || asset === null}
            onClick={handleConfirm}
            type="button"
          >
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
