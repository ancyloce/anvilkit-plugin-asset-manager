#!/usr/bin/env node

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { createAssetRegistry } from "../dist/index.js";
import {
	AssetBrowser,
	AssetManagerUI,
	UploadButton,
} from "../dist/ui/index.js";

const registry = createAssetRegistry();
registry.register({
	id: "asset-1",
	url: "https://cdn.example.com/asset.png",
	meta: {
		mimeType: "image/png",
		size: 5,
	},
});

const uploader = async () => ({
	id: "asset-2",
	url: "https://cdn.example.com/asset-2.png",
});

for (const element of [
	React.createElement(AssetBrowser, {
		assets: registry.list(),
		onInsert() {},
	}),
	React.createElement(UploadButton, {
		uploader,
	}),
	React.createElement(AssetManagerUI, {
		registry,
		uploader,
	}),
]) {
	renderToStaticMarkup(element);
}

console.log("check-ui-dist: OK - dist UI components render without runtime errors.");
