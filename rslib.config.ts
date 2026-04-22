import { defineConfig } from "@rslib/core";

/**
 * Bundleless build for `@anvilkit/plugin-asset-manager`.
 *
 * Headless runtime files and React UI subpath entries compile into
 * parallel ESM + CJS outputs under `dist/`. Workspace packages and
 * host peers stay external so the main entry remains a thin plugin
 * layer and the UI ships only from `./ui`.
 */
export default defineConfig({
	source: {
		entry: {
			index: [
				"./src/**/*.ts",
				"./src/**/*.tsx",
				"!./src/**/*.test.ts",
				"!./src/**/*.test.tsx",
				"!./src/**/*.spec.ts",
				"!./src/**/*.spec.tsx",
				"!./src/**/__tests__/**",
			],
		},
	},
	lib: [
		{
			bundle: false,
			dts: {
				autoExtension: true,
			},
			format: "esm",
		},
		{
			bundle: false,
			dts: {
				autoExtension: true,
			},
			format: "cjs",
		},
	],
	output: {
		target: "node",
		externals: [
			"@anvilkit/core",
			"@anvilkit/ir",
			"@anvilkit/ui",
			"@anvilkit/utils",
			"@puckeditor/core",
			"react",
			"react-dom",
		],
	},
});
