/** @vitest-environment happy-dom */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { UploadResult } from "../../types.js";
import { AssetBrowser } from "../AssetBrowser.js";
import { cleanup, fireEvent, render, screen } from "./test-utils.js";

afterEach(() => {
	cleanup();
});

const noop = () => undefined;

function makeAssets(count: number): readonly UploadResult[] {
	return Array.from({ length: count }, (_value, index) => ({
		id: `asset-${index + 1}`,
		url: `https://cdn.example.com/asset-${index + 1}.png`,
		meta: { mimeType: "image/png" },
	}));
}

describe("AssetBrowser", () => {
	it("renders the asset list with keyboard navigation", () => {
		const assets = makeAssets(2);
		const onInsert = vi.fn();

		render(<AssetBrowser assets={assets} onInsert={onInsert} />);

		expect(screen.getByRole("list", { name: "Assets" })).toBeTruthy();
		expect(screen.getAllByRole("listitem")).toHaveLength(2);

		const buttons = screen.getAllByRole("button", {
			name: /Insert asset/i,
		});
		buttons[0]?.focus();
		fireEvent.keyDown(buttons[0]!, { key: "ArrowDown" });
		expect(document.activeElement).toBe(buttons[1]);

		fireEvent.keyDown(buttons[1]!, { key: "ArrowUp" });
		expect(document.activeElement).toBe(buttons[0]);

		fireEvent.keyDown(buttons[1]!, { key: "Enter" });
		expect(onInsert).toHaveBeenCalledWith(assets[1]);
	});

	it("only renders the windowed slice when assets exceed the threshold", () => {
		const assets = makeAssets(200);
		render(
			<AssetBrowser
				assets={assets}
				itemHeight={50}
				maxHeight={400}
				onInsert={noop}
				virtualizeThreshold={50}
			/>,
		);

		const buttons = screen.getAllByRole("button", {
			name: /Insert asset/i,
		});
		expect(buttons.length).toBeLessThan(200);
		expect(buttons.length).toBeGreaterThan(0);
	});

	it("annotates rendered rows with aria-setsize and aria-posinset", () => {
		const assets = makeAssets(120);
		render(<AssetBrowser assets={assets} onInsert={noop} />);

		const firstRow = screen.getAllByRole("listitem")[0];
		expect(firstRow?.getAttribute("aria-setsize")).toBe("120");
		expect(firstRow?.getAttribute("aria-posinset")).toBe("1");
	});

	it("Home and End jump focus to first and last assets", () => {
		const assets = makeAssets(4);
		render(<AssetBrowser assets={assets} onInsert={noop} />);

		const buttons = screen.getAllByRole("button", {
			name: /Insert asset/i,
		});
		buttons[0]?.focus();

		fireEvent.keyDown(buttons[0]!, { key: "End" });
		expect(document.activeElement).toBe(buttons[buttons.length - 1]);

		fireEvent.keyDown(buttons[buttons.length - 1]!, { key: "Home" });
		expect(document.activeElement).toBe(buttons[0]);
	});
});
