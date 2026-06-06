import type { StudioHeaderAction } from "@anvilkit/core/types";

export const uploadAssetAction: StudioHeaderAction = {
	id: "asset-manager:upload",
	// Resolved by the core chrome via `useMsg(labelKey)` against the
	// registered `assetManager.*` catalog. `label` kept as the fallback.
	labelKey: "assetManager.action.upload",
	label: "Upload asset",
	icon: "upload",
	group: "secondary",
	onClick(ctx) {
		ctx.emit("asset-manager:upload-requested");
	},
};
