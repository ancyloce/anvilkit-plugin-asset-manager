/** @vitest-environment happy-dom */

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";

import { createAssetRegistry } from "../../registry.js";
import { AssetManagerUI } from "../AssetManagerUI.js";

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
