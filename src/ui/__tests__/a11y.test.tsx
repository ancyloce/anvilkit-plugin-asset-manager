/** @vitest-environment happy-dom */

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";

import type { AssetFolder } from "../../types/folders.js";
import { createAssetRegistry } from "../../utils/registry.js";
import { AssetManagerUI } from "../AssetManagerUI.js";
import { FolderBreadcrumb } from "../FolderBreadcrumb.js";
import { FolderTree } from "../FolderTree.js";
import { UnsplashPanel } from "../UnsplashPanel.js";

afterEach(() => {
	cleanup();
});

function folder(
	id: string,
	name: string,
	parentId: string | null,
): AssetFolder {
	return {
		id,
		name,
		parentId,
		createdAt: 0,
		updatedAt: 0,
		counts: { assets: 2, folders: 0 },
	};
}

describe("AssetManagerUI accessibility", () => {
	it("has no axe violations", async () => {
		const registry = createAssetRegistry();
		registry.register({
			id: "asset-1",
			url: "https://cdn.example.com/image.png",
			meta: {
				mimeType: "image/png",
				size: 5,
			},
		});

		const { container } = render(
			<AssetManagerUI
				onAssetInserted={vi.fn()}
				registry={registry}
				uploader={vi.fn(async () => ({
					id: "asset-2",
					url: "https://cdn.example.com/image-2.png",
				}))}
			/>,
		);

		const results = await axe(container);
		expect(results.violations).toHaveLength(0);
	});
});

describe("Folder + Unsplash chrome accessibility", () => {
	it("FolderTree has no axe violations", async () => {
		const { container } = render(
			<FolderTree
				folders={[folder("a", "Marketing", null), folder("b", "Q3", "a")]}
				currentFolderId="a"
				onNavigate={vi.fn()}
				onDropAssets={vi.fn()}
			/>,
		);
		const results = await axe(container);
		expect(results.violations).toHaveLength(0);
	});

	it("FolderBreadcrumb has no axe violations", async () => {
		const { container } = render(
			<FolderBreadcrumb
				path={[folder("a", "Marketing", null), folder("b", "Q3", "a")]}
				onNavigate={vi.fn()}
			/>,
		);
		const results = await axe(container);
		expect(results.violations).toHaveLength(0);
	});

	it("UnsplashPanel has no axe violations", async () => {
		const { container } = render(
			<UnsplashPanel
				themes={[{ id: "nature", label: "Nature" }]}
				activeThemeId="nature"
				onThemeChange={vi.fn()}
				query="mountains"
				onQueryChange={vi.fn()}
				results={[
					{
						id: "unsplash:p1",
						thumbnailUrl: "https://images.unsplash.com/p1-small",
						photographerName: "Jane Doe",
						photographerUrl: "https://unsplash.com/@jane?utm_source=demo",
						unsplashUrl: "https://unsplash.com/?utm_source=demo",
					},
				]}
				status="idle"
				onPick={vi.fn()}
			/>,
		);
		const results = await axe(container);
		expect(results.violations).toHaveLength(0);
	});
});
