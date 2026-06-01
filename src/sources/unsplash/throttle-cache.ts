/**
 * @file Rate-limit discipline for Unsplash JSON calls (PRD 0002 §8.5): an
 * LRU+TTL result cache and a single-flight throttle that enforces a minimum
 * interval between requests. Clock + wait are injectable for deterministic tests.
 */

export interface TtlCache<T> {
	get(key: string, now: number): T | undefined;
	set(key: string, value: T, now: number): void;
	readonly size: number;
}

export function createTtlCache<T>(
	ttlMs: number,
	maxEntries = 100,
): TtlCache<T> {
	const map = new Map<string, { value: T; expires: number }>();
	return {
		get(key, now) {
			const entry = map.get(key);
			if (entry === undefined) return undefined;
			if (entry.expires <= now) {
				map.delete(key);
				return undefined;
			}
			// LRU bump: re-insert to mark most-recently-used.
			map.delete(key);
			map.set(key, entry);
			return entry.value;
		},
		set(key, value, now) {
			if (!map.has(key) && map.size >= maxEntries) {
				const oldest = map.keys().next().value;
				if (oldest !== undefined) map.delete(oldest);
			}
			map.set(key, { value, expires: now + ttlMs });
		},
		get size() {
			return map.size;
		},
	};
}

export interface SingleFlightThrottle {
	run<T>(task: () => Promise<T>): Promise<T>;
}

export interface CreateThrottleOptions {
	readonly minIntervalMs: number;
	readonly now?: () => number;
	readonly wait?: (ms: number) => Promise<void>;
}

/**
 * Serializes tasks and guarantees at least `minIntervalMs` between the *starts*
 * of consecutive tasks — the politeness Unsplash's quota requires.
 */
export function createSingleFlightThrottle(
	options: CreateThrottleOptions,
): SingleFlightThrottle {
	const now = options.now ?? (() => Date.now());
	const wait =
		options.wait ??
		((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
	let last = Number.NEGATIVE_INFINITY;
	let chain: Promise<unknown> = Promise.resolve();

	return {
		run<T>(task: () => Promise<T>): Promise<T> {
			const result = chain.then(async () => {
				const elapsed = now() - last;
				if (elapsed < options.minIntervalMs) {
					await wait(options.minIntervalMs - elapsed);
				}
				last = now();
				return task();
			});
			// Keep the chain alive regardless of this task's success/failure.
			chain = result.then(
				() => undefined,
				() => undefined,
			);
			return result;
		},
	};
}
