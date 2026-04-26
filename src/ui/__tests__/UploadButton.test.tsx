/** @vitest-environment happy-dom */

import { render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { UploadButton } from "../UploadButton.js";

describe("UploadButton", () => {
	it("uploads a file and emits the validated asset metadata", async () => {
		const uploader = vi.fn(async () => ({
			id: "asset-1",
			url: "https://cdn.example.com/image.png",
		}));
		const onUploaded = vi.fn();
		const user = userEvent.setup();
		const { container } = render(
			<UploadButton onUploaded={onUploaded} uploader={uploader} />,
		);

		const input = container.querySelector("input[type='file']");
		if (!(input instanceof HTMLInputElement)) {
			throw new Error("UploadButton test could not locate the file input.");
		}

		const file = new File(["hello"], "image.png", { type: "image/png" });
		await user.upload(input, file);

		await waitFor(() => {
			expect(uploader).toHaveBeenCalledWith(file);
		});
		expect(onUploaded).toHaveBeenCalledWith({
			id: "asset-1",
			url: "https://cdn.example.com/image.png",
			meta: {
				size: 5,
				mimeType: "image/png",
			},
		});
	});
});
