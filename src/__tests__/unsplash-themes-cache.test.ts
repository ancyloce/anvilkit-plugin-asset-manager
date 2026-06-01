import { describe, expect, it } from "vitest";

import {
	ALL_THEME_ID,
	DEFAULT_UNSPLASH_THEMES,
	resolveDefaultThemeId,
	resolveThemes,
} from "../sources/unsplash/themes.js";
import {
	createSingleFlightThrottle,
	createTtlCache,
} from "../sources/unsplash/throttle-cache.js";

describe("resolveThemes", () => {
	it("prepends the __all__ free-search theme to the defaults", () => {
		const themes = resolveThemes();
		expect(themes[0]?.id).toBe(ALL_THEME_ID);
		expect(themes).toHaveLength(DEFAULT_UNSPLASH_THEMES.length + 1);
		expect(themes.some((t) => t.id === "nature")).toBe(true);
	});

	it("omits __all__ when allowFreeSearch is false", () => {
		const themes = resolveThemes({ allowFreeSearch: false });
		expect(themes.some((t) => t.id === ALL_THEME_ID)).toBe(false);
	});

	it("replaces the defaults entirely when `themes` is supplied", () => {
		const themes = resolveThemes({
			themes: [{ id: "only", label: "x", query: "q" }],
		});
		expect(themes.map((t) => t.id)).toEqual([ALL_THEME_ID, "only"]);
	});

	it("filters excludeThemes and appends additionalThemes", () => {
		const themes = resolveThemes({
			excludeThemes: ["people", "texture"],
			additionalThemes: [{ id: "interiors", label: "i", topicSlugs: ["x"] }],
		});
		const ids = themes.map((t) => t.id);
		expect(ids).not.toContain("people");
		expect(ids).not.toContain("texture");
		expect(ids).toContain("interiors");
	});

	it("resolveDefaultThemeId honors a valid configured default, else the first", () => {
		const themes = resolveThemes();
		expect(resolveDefaultThemeId(themes, { defaultThemeId: "business" })).toBe(
			"business",
		);
		expect(resolveDefaultThemeId(themes, { defaultThemeId: "ghost" })).toBe(
			ALL_THEME_ID,
		);
		expect(resolveDefaultThemeId(themes)).toBe(ALL_THEME_ID);
	});
});

describe("createTtlCache", () => {
	it("returns cached values within the TTL and evicts after", () => {
		const cache = createTtlCache<number>(1000);
		cache.set("a", 1, 0);
		expect(cache.get("a", 500)).toBe(1);
		expect(cache.get("a", 1000)).toBeUndefined(); // expires at now+ttl, inclusive
		expect(cache.get("a", 1500)).toBeUndefined();
	});

	it("evicts the least-recently-used entry at capacity", () => {
		const cache = createTtlCache<number>(10_000, 2);
		cache.set("a", 1, 0);
		cache.set("b", 2, 0);
		cache.get("a", 1); // bump a → b is now LRU
		cache.set("c", 3, 1); // evicts b
		expect(cache.get("b", 2)).toBeUndefined();
		expect(cache.get("a", 2)).toBe(1);
		expect(cache.get("c", 2)).toBe(3);
	});
});

describe("createSingleFlightThrottle", () => {
	it("enforces the minimum interval between task starts (injected clock)", async () => {
		let clock = 0;
		const waits: number[] = [];
		const throttle = createSingleFlightThrottle({
			minIntervalMs: 1000,
			now: () => clock,
			wait: async (ms) => {
				waits.push(ms);
				clock += ms; // simulate time passing during the wait
			},
		});

		await throttle.run(async () => "first"); // no wait (elapsed = Infinity)
		clock += 200; // 200ms later
		await throttle.run(async () => "second"); // needs 800ms more
		expect(waits).toEqual([800]);
	});

	it("serializes tasks and survives a rejecting task", async () => {
		const throttle = createSingleFlightThrottle({
			minIntervalMs: 0,
			now: () => 0,
			wait: async () => undefined,
		});
		await expect(
			throttle.run(async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		await expect(throttle.run(async () => "ok")).resolves.toBe("ok");
	});
});
