/** @vitest-environment happy-dom */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { UploadResult } from "../../types.js";
import { AssetBrowser } from "../AssetBrowser.js";

describe("AssetBrowser", () => {
	it("renders the asset list with keyboard navigation", () => {
		const assets: readonly UploadResult[] = [
			{
				id: "asset-1",
				url: "https://cdn.example.com/asset-1.png",
				meta: { mimeType: "image/png" },
			},
			{
				id: "asset-2",
				url: "https://cdn.example.com/asset-2.png",
				meta: { mimeType: "image/png" },
			},
		];
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
});
