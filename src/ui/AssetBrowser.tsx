"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@anvilkit/ui/card";
import { Input } from "@anvilkit/ui/input";
import * as React from "react";
import { flushSync } from "react-dom";

import { inferAssetKind } from "../utils/infer-kind.js";
import type { AssetKind, UploadResult } from "../types/types.js";

const KIND_FILTERS: readonly AssetKind[] = [
  "image",
  "video",
  "audio",
  "font",
  "document",
];

export interface AssetBrowserProps {
  readonly assets: readonly UploadResult[];
  readonly onInsert: (asset: UploadResult) => void;
  /**
   * Optional delete affordance. When provided each row renders a
   * "Delete" action that hands the asset back to the host — typically
   * to open a `DeleteAssetDialog`.
   */
  readonly onDelete?: (asset: UploadResult) => void;
  /**
   * Optional replace affordance. When provided each row renders a
   * "Replace" action — typically to open a `ReplaceAssetDialog`.
   */
  readonly onReplace?: (asset: UploadResult) => void;
  /**
   * Optional metadata-edit affordance. When provided each row renders
   * an "Edit" action — typically to open a `MetadataPanel` dialog so
   * the user can rename + retag the asset.
   */
  readonly onEdit?: (asset: UploadResult) => void;
  /**
   * When `true`, renders the search input + kind chip row above the
   * list. Off by default so existing AssetBrowser embeds (which
   * pre-filter at the host layer) keep their previous chrome.
   */
  readonly searchEnabled?: boolean;
  /**
   * Page size used by the "Load more" affordance once the visible
   * slice exceeds this number. Defaults to 100.
   */
  readonly pageSize?: number;
  /**
   * Threshold above which the list windows visible items. Below the
   * threshold the entire list renders inline so small libraries skip
   * scroll math entirely.
   */
  readonly virtualizeThreshold?: number;
  /**
   * Pixel height of a single row when virtualizing.
   *
   * **Fixed-height contract:** the windowing math (visible range, scroll
   * offset, and keyboard-focus scroll) assumes every row is exactly
   * `itemHeight` tall. Rows that wrap or vary in height (long names,
   * thumbnails) will desync the scroll position and focus calculation.
   * Keep rows uniform, or raise `virtualizeThreshold` so the list renders
   * inline instead.
   */
  readonly itemHeight?: number;
  /** Pixel height of the scroll container when virtualizing. */
  readonly maxHeight?: number;
}

const DEFAULT_VIRTUALIZE_THRESHOLD = 50;
const DEFAULT_ITEM_HEIGHT = 56;
const DEFAULT_MAX_HEIGHT = 400;
const DEFAULT_PAGE_SIZE = 100;
const OVERSCAN = 4;

export function AssetBrowser({
  assets,
  onInsert,
  onDelete,
  onReplace,
  onEdit,
  searchEnabled = false,
  pageSize = DEFAULT_PAGE_SIZE,
  virtualizeThreshold = DEFAULT_VIRTUALIZE_THRESHOLD,
  itemHeight = DEFAULT_ITEM_HEIGHT,
  maxHeight = DEFAULT_MAX_HEIGHT,
}: AssetBrowserProps) {
  const [activeIndex, setActiveIndex] = React.useState(
    assets.length > 0 ? 0 : -1,
  );
  const [scrollTop, setScrollTop] = React.useState(0);
  const [query, setQuery] = React.useState("");
  const [activeKinds, setActiveKinds] = React.useState<readonly AssetKind[]>(
    [],
  );
  const [pageLimit, setPageLimit] = React.useState(pageSize);
  const buttonRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const scrollContainerRef = React.useRef<HTMLDivElement | null>(null);
  // Coalesces scroll-driven re-renders to one per animation frame.
  const scrollFrameRef = React.useRef<number | null>(null);
  const pendingScrollTopRef = React.useRef(0);

  React.useEffect(
    () => () => {
      if (
        scrollFrameRef.current !== null &&
        typeof cancelAnimationFrame === "function"
      ) {
        cancelAnimationFrame(scrollFrameRef.current);
      }
    },
    [],
  );

  // Lowercase each asset's searchable fields once per `assets` identity
  // rather than on every keystroke. Fields are joined with a NUL
  // (\u0000) so one `includes` covers id/name/mime/tags while keeping
  // the original per-field match semantics: a user query never
  // contains NUL, so it cannot match across the field boundary.
  const searchIndex = React.useMemo(() => {
    if (!searchEnabled) return null;
    return assets.map((asset) => ({
      asset,
      kind: inferAssetKind(asset),
      haystack: [
        asset.id,
        asset.name ?? "",
        asset.meta?.mimeType ?? "",
        ...(asset.tags ?? []),
      ]
        .join("\u0000")
        .toLowerCase(),
    }));
  }, [assets, searchEnabled]);

  const filteredAssets = React.useMemo(() => {
    if (!searchEnabled || searchIndex === null) return assets;
    const lower = query.trim().toLowerCase();
    const hasKindFilter = activeKinds.length > 0;
    if (lower === "" && !hasKindFilter) return assets;
    const result: UploadResult[] = [];
    for (const entry of searchIndex) {
      if (hasKindFilter && !activeKinds.includes(entry.kind)) continue;
      if (lower === "" || entry.haystack.includes(lower)) {
        result.push(entry.asset);
      }
    }
    return result;
  }, [assets, searchIndex, activeKinds, query, searchEnabled]);

  const visibleSlice = React.useMemo(
    () => (searchEnabled ? filteredAssets.slice(0, pageLimit) : filteredAssets),
    [filteredAssets, pageLimit, searchEnabled],
  );

  const total = visibleSlice.length;
  const isVirtualized = total > virtualizeThreshold;
  const hasMore = searchEnabled && filteredAssets.length > visibleSlice.length;

  React.useEffect(() => {
    if (total === 0) {
      setActiveIndex(-1);
      return;
    }

    setActiveIndex((currentIndex) =>
      currentIndex >= 0 && currentIndex < total ? currentIndex : 0,
    );
  }, [total]);

  function moveFocus(nextIndex: number) {
    if (total === 0) {
      return;
    }

    const clampedIndex = Math.max(0, Math.min(nextIndex, total - 1));

    if (isVirtualized && scrollContainerRef.current) {
      const targetTop = clampedIndex * itemHeight;
      const targetBottom = targetTop + itemHeight;
      const viewTop = scrollContainerRef.current.scrollTop;
      let nextScrollTop = viewTop;
      if (targetTop < viewTop) {
        nextScrollTop = targetTop;
      } else if (targetBottom > viewTop + maxHeight) {
        nextScrollTop = targetBottom - maxHeight;
      }
      // Cancel any pending scroll-driven rAF so its stale captured
      // `pendingScrollTopRef` value cannot overwrite the new
      // keyboard-driven scroll position after this commit.
      if (
        scrollFrameRef.current !== null &&
        typeof cancelAnimationFrame === "function"
      ) {
        cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
      pendingScrollTopRef.current = nextScrollTop;
      // Commit the new active index AND scroll position synchronously
      // so the windowed slice re-renders and the target row is mounted
      // before we move focus — otherwise an off-window keyboard jump
      // would focus a node that doesn't exist yet.
      flushSync(() => {
        setActiveIndex(clampedIndex);
        setScrollTop(nextScrollTop);
      });
      scrollContainerRef.current.scrollTop = nextScrollTop;
      buttonRefs.current[clampedIndex]?.focus();
      return;
    }

    setActiveIndex(clampedIndex);
    buttonRefs.current[clampedIndex]?.focus();
  }

  function toggleKind(kind: AssetKind) {
    setActiveKinds((current) =>
      current.includes(kind)
        ? current.filter((entry) => entry !== kind)
        : [...current, kind],
    );
  }

  const firstVisible = isVirtualized
    ? Math.max(0, Math.floor(scrollTop / itemHeight) - OVERSCAN)
    : 0;
  const lastVisible = isVirtualized
    ? Math.min(
        total - 1,
        Math.ceil((scrollTop + maxHeight) / itemHeight) + OVERSCAN,
      )
    : total - 1;

  const visibleAssets =
    total === 0
      ? []
      : isVirtualized
        ? visibleSlice.slice(firstVisible, lastVisible + 1)
        : visibleSlice;

  function renderRow(asset: UploadResult, index: number) {
    return (
      <li
        aria-posinset={index + 1}
        aria-setsize={total}
        key={asset.id}
        role="listitem"
      >
        <button
          aria-label={`Insert asset ${asset.id}`}
          onClick={() => {
            onInsert(asset);
          }}
          onFocus={() => {
            setActiveIndex(index);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              moveFocus(index + 1);
              return;
            }

            if (event.key === "ArrowUp") {
              event.preventDefault();
              moveFocus(index - 1);
              return;
            }

            if (event.key === "Home") {
              event.preventDefault();
              moveFocus(0);
              return;
            }

            if (event.key === "End") {
              event.preventDefault();
              moveFocus(total - 1);
              return;
            }

            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onInsert(asset);
            }
          }}
          ref={(node) => {
            buttonRefs.current[index] = node;
          }}
          tabIndex={activeIndex === index ? 0 : -1}
          type="button"
        >
          <span>{asset.id}</span>
          <span>{asset.meta?.mimeType ?? "unknown type"}</span>
        </button>
        {onEdit !== undefined ? (
          <button
            aria-label={`Edit asset ${asset.id}`}
            data-asset-action="edit"
            onClick={() => {
              onEdit(asset);
            }}
            type="button"
          >
            Edit
          </button>
        ) : null}
        {onReplace !== undefined ? (
          <button
            aria-label={`Replace asset ${asset.id}`}
            data-asset-action="replace"
            onClick={() => {
              onReplace(asset);
            }}
            type="button"
          >
            Replace
          </button>
        ) : null}
        {onDelete !== undefined ? (
          <button
            aria-label={`Delete asset ${asset.id}`}
            data-asset-action="delete"
            onClick={() => {
              onDelete(asset);
            }}
            type="button"
          >
            Delete
          </button>
        ) : null}
      </li>
    );
  }

  const filterRow = searchEnabled ? (
    <div data-asset-manager-filters>
      <Input
        aria-label="Search assets"
        onChange={(event) => {
          setQuery(event.target.value);
          setPageLimit(pageSize);
        }}
        placeholder="Search by name, tag, or MIME"
        value={query}
      />
      <div aria-label="Asset kind filters" role="group">
        {KIND_FILTERS.map((kind) => {
          const active = activeKinds.includes(kind);
          return (
            <button
              aria-label={`Filter ${kind} assets`}
              aria-pressed={active}
              data-asset-kind-filter={kind}
              key={kind}
              onClick={() => {
                toggleKind(kind);
                setPageLimit(pageSize);
              }}
              type="button"
            >
              {kind}
            </button>
          );
        })}
      </div>
    </div>
  ) : null;

  if (total === 0) {
    const emptyLabel =
      searchEnabled && (query !== "" || activeKinds.length > 0)
        ? "No assets match the current filters."
        : "No assets uploaded yet.";
    return (
      <Card>
        <CardHeader>
          <CardTitle>Asset browser</CardTitle>
          <CardDescription>
            Validated assets currently registered in memory.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {filterRow}
          <ul aria-label="Assets" role="list">
            <li role="listitem">{emptyLabel}</li>
          </ul>
        </CardContent>
      </Card>
    );
  }

  if (!isVirtualized) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Asset browser</CardTitle>
          <CardDescription>
            Validated assets currently registered in memory.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {filterRow}
          <ul aria-label="Assets" role="list">
            {visibleAssets.map((asset, offset) => renderRow(asset, offset))}
          </ul>
          {hasMore ? (
            <button
              data-asset-action="load-more"
              onClick={() => {
                setPageLimit((current) => current + pageSize);
              }}
              type="button"
            >
              Load more
            </button>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  const totalHeight = total * itemHeight;
  const offsetY = firstVisible * itemHeight;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Asset browser</CardTitle>
        <CardDescription>
          Validated assets currently registered in memory.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {filterRow}
        <div
          data-asset-manager-virtual
          onScroll={(event) => {
            const next = event.currentTarget.scrollTop;
            if (typeof requestAnimationFrame !== "function") {
              setScrollTop(next);
              return;
            }
            pendingScrollTopRef.current = next;
            if (scrollFrameRef.current !== null) {
              return;
            }
            scrollFrameRef.current = requestAnimationFrame(() => {
              scrollFrameRef.current = null;
              setScrollTop(pendingScrollTopRef.current);
            });
          }}
          ref={scrollContainerRef}
          style={{ height: maxHeight, overflowY: "auto", position: "relative" }}
        >
          <div style={{ height: totalHeight, position: "relative" }}>
            <ul
              aria-label="Assets"
              role="list"
              style={{
                margin: 0,
                padding: 0,
                position: "absolute",
                top: offsetY,
                left: 0,
                right: 0,
              }}
            >
              {visibleAssets.map((asset, offset) =>
                renderRow(asset, firstVisible + offset),
              )}
            </ul>
          </div>
        </div>
        {hasMore ? (
          <button
            data-asset-action="load-more"
            onClick={() => {
              setPageLimit((current) => current + pageSize);
            }}
            type="button"
          >
            Load more
          </button>
        ) : null}
      </CardContent>
    </Card>
  );
}
