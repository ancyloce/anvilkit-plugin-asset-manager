import type { StudioHeaderAction } from "@anvilkit/core/types";

export const uploadAssetAction: StudioHeaderAction = {
	id: "asset-manager:upload",
	label: "Upload asset",
	icon: "upload",
	group: "secondary",
	onClick(ctx) {
		ctx.emit("asset-manager:upload-requested");
	},
};
