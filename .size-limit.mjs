/**
 * Measure the code fetched for the initial entry point. Optional providers,
 * resumable uploads, content sniffing, and locale catalogs are loaded only when
 * requested, so they remain separate network transfers instead of being charged
 * to every consumer's initial download.
 */
function initialChunkOnly(config) {
	return {
		...config,
		plugins: [
			...(config.plugins ?? []),
			{
				name: "asset-manager-initial-chunk",
				setup(build) {
					build.onResolve({ filter: /.*/ }, (args) =>
						args.kind === "dynamic-import"
							? { external: true, path: args.path }
							: undefined,
					);
				},
			},
		],
	};
}

export default [
	{
		name: "@anvilkit/plugin-asset-manager (initial chunk)",
		path: "dist/index.js",
		limit: "17 KB",
		gzip: true,
		modifyEsbuildConfig: initialChunkOnly,
		ignore: [
			"react",
			"react-dom",
			"@puckeditor/core",
			"@anvilkit/core",
			"@anvilkit/ir",
			"@anvilkit/ui",
			"@anvilkit/utils",
		],
	},
	{
		name: "@anvilkit/plugin-asset-manager/ui (initial chunk)",
		path: "dist/ui/index.js",
		limit: "12 KB",
		gzip: true,
		modifyEsbuildConfig: initialChunkOnly,
		ignore: [
			"react",
			"react-dom",
			"@puckeditor/core",
			"@anvilkit/core",
			"@anvilkit/ir",
			"@anvilkit/ui",
			"@anvilkit/utils",
			"lucide-react",
		],
	},
	{
		name: "@anvilkit/plugin-asset-manager/retry",
		path: "dist/utils/retry.js",
		limit: "1 KB",
		gzip: true,
	},
	{
		name: "@anvilkit/plugin-asset-manager/session-store",
		path: "dist/utils/upload-session-store.js",
		limit: "1.5 KB",
		gzip: true,
	},
	{
		name: "@anvilkit/plugin-asset-manager/adapters/s3",
		path: "dist/adapters/s3-presigned.js",
		limit: "3 KB",
		gzip: true,
		ignore: ["@anvilkit/core", "@anvilkit/ir", "@anvilkit/utils"],
	},
	{
		name: "@anvilkit/plugin-asset-manager/providers/unsplash",
		path: "dist/sources/unsplash/index.js",
		limit: "4 KB",
		gzip: true,
		ignore: ["@anvilkit/core"],
	},
];
