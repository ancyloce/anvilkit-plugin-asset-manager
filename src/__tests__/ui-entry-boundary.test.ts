import { readdir, readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("UI entry boundary", () => {
	it("does not import the full headless plugin graph", async () => {
		const uiDirectory = new URL("../ui/", import.meta.url);
		const sourceFiles = (await readdir(uiDirectory)).filter(
			(fileName) => fileName.endsWith(".ts") || fileName.endsWith(".tsx"),
		);

		const pluginImports: string[] = [];
		for (const fileName of sourceFiles) {
			const source = await readFile(new URL(fileName, uiDirectory), "utf8");
			if (/from\s+["']\.\.\/plugin(?:\.js)?["']/.test(source)) {
				pluginImports.push(fileName);
			}
		}

		expect(pluginImports).toEqual([]);
	});
});
