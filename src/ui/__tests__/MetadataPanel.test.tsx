/** @vitest-environment happy-dom */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { UploadResult } from "../../types.js";
import { MetadataPanel } from "../MetadataPanel.js";
import { cleanup, fireEvent, render, screen } from "./test-utils.js";

afterEach(() => {
	cleanup();
});

const ASSET: UploadResult = {
	id: "img-hero",
	url: "https://cdn.example.com/hero.png",
	name: "hero.png",
	meta: { mimeType: "image/png" },
	tags: ["image", "hero"],
};

describe("MetadataPanel", () => {
	it("seeds the form from the supplied asset", () => {
		render(
			<MetadataPanel
				asset={ASSET}
				onCancel={() => undefined}
				onConfirm={() => undefined}
			/>,
		);

		const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
		expect(nameInput.value).toBe("hero.png");

		const tags = screen.getByLabelText("Current tags");
		expect(tags.textContent).toContain("image");
		expect(tags.textContent).toContain("hero");
	});

	it("Save calls onConfirm with the edited name and tag set", async () => {
		const onConfirm = vi.fn(async () => undefined);
		render(
			<MetadataPanel
				asset={ASSET}
				onCancel={() => undefined}
				onConfirm={onConfirm}
			/>,
		);

		const nameInput = screen.getByLabelText("Name");
		fireEvent.change(nameInput, { target: { value: "renamed.png" } });

		const tagInput = screen.getByLabelText("Tags");
		fireEvent.change(tagInput, { target: { value: "marketing" } });
		fireEvent.keyDown(tagInput, { key: "Enter" });

		const save = screen.getByRole("button", { name: /Save/i });
		fireEvent.click(save);

		await Promise.resolve();
		expect(onConfirm).toHaveBeenCalledTimes(1);
		const [calledAsset, calledNext] = onConfirm.mock.calls[0] ?? [];
		expect(calledAsset?.id).toBe("img-hero");
		expect(calledNext?.name).toBe("renamed.png");
		expect(calledNext?.tags).toEqual(["image", "hero", "marketing"]);
	});

	it("removing a tag drops it from the next set", async () => {
		const onConfirm = vi.fn(async () => undefined);
		render(
			<MetadataPanel
				asset={ASSET}
				onCancel={() => undefined}
				onConfirm={onConfirm}
			/>,
		);

		const removeHero = screen.getByLabelText("Remove tag hero");
		fireEvent.click(removeHero);

		fireEvent.click(screen.getByRole("button", { name: /Save/i }));
		await Promise.resolve();

		const [, calledNext] = onConfirm.mock.calls[0] ?? [];
		expect(calledNext?.tags).toEqual(["image"]);
	});

	it("Cancel closes without confirming", () => {
		const onConfirm = vi.fn();
		const onCancel = vi.fn();
		render(
			<MetadataPanel asset={ASSET} onCancel={onCancel} onConfirm={onConfirm} />,
		);

		fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));
		expect(onCancel).toHaveBeenCalledTimes(1);
		expect(onConfirm).not.toHaveBeenCalled();
	});
});
