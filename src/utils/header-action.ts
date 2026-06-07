import type { StudioHeaderAction } from "@anvilkit/core/types";

export const uploadAssetAction: StudioHeaderAction = {
	id: "asset-manager:upload",
	// Resolved by the core chrome via `useMsg(labelKey)` against the
	// registered `assetManager.*` catalog (registered at compile time, so the
	// key resolves before the action ever renders).
	labelKey: "assetManager.action.upload",
	icon: "upload",
	group: "secondary",
	onClick(ctx) {
		ctx.emit("asset-manager:upload-requested");
	},
};
