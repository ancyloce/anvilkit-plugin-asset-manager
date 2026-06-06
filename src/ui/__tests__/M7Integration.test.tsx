/** @vitest-environment happy-dom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { AssetBrowser } from "../AssetBrowser.js";
import { ASSET_DRAG_MIME } from "../FolderTree.js";
import { UnsplashPanel, type UnsplashResult } from "../UnsplashPanel.js";
import { cleanup, fireEvent, render, screen, waitFor } from "./test-utils.js";

afterEach(() => {
	cleanup();
});

const result: UnsplashResult = {
	id: "unsplash:p1",
	thumbnailUrl: "https://images.unsplash.com/p1-small",
	photographerName: "Jane Doe",
	photographerUrl: "https://unsplash.com/@jane?utm_source=demo",
	unsplashUrl: "https://unsplash.com/?utm_source=demo",
};

describe("UnsplashPanel", () => {
	it("renders the disabled state when status is disabled", () => {
		render(
			<UnsplashPanel
				themes={[]}
				onThemeChange={vi.fn()}
				query=""
				onQueryChange={vi.fn()}
				results={[]}
				status="disabled"
				onPick={vi.fn()}
			/>,
		);
		const disabled = screen.getByTestId("ak-unsplash-disabled");
		expect(disabled).toBeTruthy();
		// Announced to assistive tech, like the error/rate-limit states.
		expect(disabled.getAttribute("role")).toBe("status");
	});

	it("renders results with attribution and picks on click", async () => {
		const onPick = vi.fn().mockResolvedValue(undefined);
		render(
			<UnsplashPanel
				themes={[{ id: "nature", label: "Nature" }]}
				activeThemeId="nature"
				onThemeChange={vi.fn()}
				query="mountains"
				onQueryChange={vi.fn()}
				results={[result]}
				status="idle"
				onPick={onPick}
			/>,
		);
		expect(screen.getByText("Jane Doe")).toBeTruthy(); // attribution link
		expect(screen.getByText("Unsplash")).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", { name: /Insert photo by Jane Doe/ }),
		);
		await waitFor(() => expect(onPick).toHaveBeenCalledWith("unsplash:p1"));
	});

	it("shows skeletons while loading the first page", () => {
		render(
			<UnsplashPanel
				themes={[]}
				onThemeChange={vi.fn()}
				query=""
				onQueryChange={vi.fn()}
				results={[]}
				status="loading"
				onPick={vi.fn()}
			/>,
		);
		expect(screen.getByTestId("ak-unsplash-skeletons")).toBeTruthy();
		// Loading is announced via a visually-hidden live region.
		expect(screen.getByTestId("ak-unsplash-status").textContent).toContain(
			"Loading",
		);
	});

	it("toggles a theme and forwards search input", () => {
		const onThemeChange = vi.fn();
		const onQueryChange = vi.fn();
		render(
			<UnsplashPanel
				themes={[{ id: "nature", label: "Nature" }]}
				onThemeChange={onThemeChange}
				query=""
				onQueryChange={onQueryChange}
				results={[]}
				status="idle"
				onPick={vi.fn()}
			/>,
		);
		fireEvent.click(screen.getByText("Nature"));
		expect(onThemeChange).toHaveBeenCalledWith("nature");
		fireEvent.change(screen.getByTestId("ak-unsplash-search"), {
			target: { value: "sea" },
		});
		expect(onQueryChange).toHaveBeenCalledWith("sea");
	});
});

describe("AssetBrowser folder integration (additive)", () => {
	const assets = [{ id: "a1", url: "https://x/a1.png" }];

	it("renders the aboveFilters slot", () => {
		render(
			<AssetBrowser
				assets={assets}
				onInsert={vi.fn()}
				searchEnabled
				aboveFilters={<div data-testid="folder-nav-slot" />}
			/>,
		);
		expect(screen.getByTestId("folder-nav-slot")).toBeTruthy();
	});

	it("makes rows draggable with an asset-id payload", () => {
		render(<AssetBrowser assets={assets} onInsert={vi.fn()} draggableRows />);
		const row = screen.getByRole("button", { name: "Insert asset a1" });
		expect(row.getAttribute("draggable")).toBe("true");
		const setData = vi.fn();
		fireEvent.dragStart(row, {
			dataTransfer: { setData, effectAllowed: "" },
		});
		expect(setData).toHaveBeenCalledWith(
			ASSET_DRAG_MIME,
			JSON.stringify(["a1"]),
		);
	});

	it("rows are not draggable by default", () => {
		render(<AssetBrowser assets={assets} onInsert={vi.fn()} />);
		const row = screen.getByRole("button", { name: "Insert asset a1" });
		expect(row.getAttribute("draggable")).not.toBe("true");
	});
});
