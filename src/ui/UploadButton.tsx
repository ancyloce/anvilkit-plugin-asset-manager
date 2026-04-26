import { Button } from "@anvilkit/ui/button";
import * as React from "react";
import { validateSelectedFile } from "../plugin.js";
import type { AssetManagerOptions, UploadResult } from "../types.js";
import { validateUploadResult } from "../validate-upload-result.js";

export interface UploadButtonProps
	extends Pick<
		AssetManagerOptions,
		"acceptedMimeTypes" | "maxFileSize" | "uploader" | "urlAllowlist"
	> {
	readonly onUploaded?: (asset: UploadResult) => void;
	readonly onError?: (error: unknown) => void;
}

export function UploadButton({
	acceptedMimeTypes,
	maxFileSize,
	onError,
	onUploaded,
	uploader,
	urlAllowlist,
}: UploadButtonProps) {
	const inputRef = React.useRef<HTMLInputElement>(null);
	const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
	const [isUploading, setIsUploading] = React.useState(false);

	async function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
		const file = event.currentTarget.files?.[0];
		if (!file) {
			return;
		}

		setIsUploading(true);
		setErrorMessage(null);

		try {
			validateSelectedFile(file, { acceptedMimeTypes, maxFileSize });
			const uploaded = await uploader(file);
			const validated = validateUploadResult(
				{
					...uploaded,
					meta: {
						size: file.size,
						...(file.type ? { mimeType: file.type } : {}),
						...(uploaded.meta ?? {}),
					},
				},
				{ urlAllowlist },
			);
			onUploaded?.(validated);
		} catch (error) {
			setErrorMessage(error instanceof Error ? error.message : String(error));
			onError?.(error);
		} finally {
			if (inputRef.current) {
				inputRef.current.value = "";
			}
			setIsUploading(false);
		}
	}

	return (
		<div>
			<input
				accept={acceptedMimeTypes?.join(",")}
				onChange={(event) => {
					void handleChange(event);
				}}
				ref={inputRef}
				style={{ display: "none" }}
				type="file"
			/>
			<Button
				aria-label="Upload asset file"
				disabled={isUploading}
				onClick={() => {
					inputRef.current?.click();
				}}
				type="button"
				variant="outline"
			>
				{isUploading ? "Uploading..." : "Upload asset"}
			</Button>
			{errorMessage ? (
				<p role="status">{errorMessage}</p>
			) : (
				<p role="status">
					Accepted files upload through the configured adapter.
				</p>
			)}
		</div>
	);
}
