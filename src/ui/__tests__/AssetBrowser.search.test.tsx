/** @vitest-environment happy-dom */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { UploadResult } from "../../types.js";
import { AssetBrowser } from "../AssetBrowser.js";
import { cleanup, fireEvent, render, screen } from "./test-utils.js";

afterEach(() => {
	cleanup();
});

const noop = () => undefined;

const ASSETS: readonly UploadResult[] = [
	{
		id: "img-hero",
		url: "https://cdn.example.com/hero.png",
		name: "hero.png",
		meta: { mimeType: "image/png" },
		tags: ["image", "hero"],
	},
	{
		id: "img-logo",
		url: "https://cdn.example.com/logo.png",
		name: "logo.png",
		meta: { mimeType: "image/png" },
		tags: ["image", "brand"],
	},
	{
		id: "vid-promo",
		url: "https://cdn.example.com/promo.mp4",
		name: "promo.mp4",
		meta: { mimeType: "video/mp4" },
		tags: ["video"],
	},
];

describe("AssetBrowser search", () => {
	it("filters the list by free-text query", () => {
		render(<AssetBrowser assets={ASSETS} onInsert={noop} searchEnabled />);

		const search = screen.getByLabelText("Search assets") as HTMLInputElement;
		fireEvent.change(search, { target: { value: "logo" } });

		const buttons = screen.getAllByRole("button", {
			name: /Insert asset/i,
		});
		expect(buttons).toHaveLength(1);
		expect(buttons[0]?.getAttribute("aria-label")).toBe(
			"Insert asset img-logo",
		);
	});

	it("filters the list by kind chip toggle", () => {
		render(<AssetBrowser assets={ASSETS} onInsert={noop} searchEnabled />);

		const videoChip = screen.getByLabelText("Filter video assets");
		fireEvent.click(videoChip);

		expect(videoChip.getAttribute("aria-pressed")).toBe("true");
		const buttons = screen.getAllByRole("button", {
			name: /Insert asset/i,
		});
		expect(buttons).toHaveLength(1);
		expect(buttons[0]?.getAttribute("aria-label")).toBe(
			"Insert asset vid-promo",
		);
	});

	it("renders a Load more button once results exceed the page size", () => {
		const many: UploadResult[] = Array.from({ length: 12 }, (_, index) => ({
			id: `asset-${index}`,
			url: `https://cdn.example.com/${index}.png`,
			name: `${index}.png`,
			meta: { mimeType: "image/png" },
		}));

		render(
			<AssetBrowser assets={many} onInsert={noop} pageSize={5} searchEnabled />,
		);

		expect(
			screen.getAllByRole("button", { name: /Insert asset/i }),
		).toHaveLength(5);

		const loadMore = screen.getByRole("button", { name: /Load more/i });
		fireEvent.click(loadMore);
		expect(
			screen.getAllByRole("button", { name: /Insert asset/i }),
		).toHaveLength(10);

		fireEvent.click(loadMore);
		expect(
			screen.getAllByRole("button", { name: /Insert asset/i }),
		).toHaveLength(12);
	});

	it("renders an Edit action when onEdit is provided", () => {
		const onEdit = vi.fn();
		render(<AssetBrowser assets={ASSETS} onEdit={onEdit} onInsert={noop} />);

		const editButton = screen.getByLabelText("Edit asset img-hero");
		fireEvent.click(editButton);
		expect(onEdit).toHaveBeenCalledWith(ASSETS[0]);
	});

	it("shows a filter-aware empty state when nothing matches", () => {
		render(<AssetBrowser assets={ASSETS} onInsert={noop} searchEnabled />);

		const search = screen.getByLabelText("Search assets") as HTMLInputElement;
		fireEvent.change(search, { target: { value: "no-such-asset" } });

		expect(
			screen.getByText("No assets match the current filters."),
		).toBeTruthy();
	});
});
