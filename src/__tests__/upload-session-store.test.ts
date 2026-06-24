import { describe, expect, it } from "vitest";

import type { PersistedUploadSession } from "../types/resumable.js";
import {
	createUploadSessionStore,
	fingerprintFile,
	type UploadSessionStorage,
} from "../utils/upload-session-store.js";

function makeFile(name: string, bytes: number, lastModified: number): File {
	return new File(["x".repeat(bytes)], name, {
		type: "image/png",
		lastModified,
	});
}

function fakeStorage(): UploadSessionStorage & {
	readonly map: Map<string, string>;
} {
	const map = new Map<string, string>();
	return {
		map,
		getItem: (key) => map.get(key) ?? null,
		setItem: (key, value) => {
			map.set(key, value);
		},
		removeItem: (key) => {
			map.delete(key);
		},
	};
}

const session: PersistedUploadSession = {
	uploadId: "mpu-1",
	partSize: 8 * 1024 * 1024,
	parts: [
		{ partNumber: 1, etag: "etag-1" },
		{ partNumber: 2, etag: "etag-2" },
	],
};

describe("fingerprintFile", () => {
	it("is stable for identical name/size/lastModified", () => {
		expect(fingerprintFile(makeFile("a.png", 10, 1000))).toBe(
			fingerprintFile(makeFile("a.png", 10, 1000)),
		);
	});

	it("differs when any attribute differs", () => {
		const base = fingerprintFile(makeFile("a.png", 10, 1000));
		expect(fingerprintFile(makeFile("b.png", 10, 1000))).not.toBe(base);
		expect(fingerprintFile(makeFile("a.png", 11, 1000))).not.toBe(base);
		expect(fingerprintFile(makeFile("a.png", 10, 1001))).not.toBe(base);
	});

	it("percent-encodes the name so the delimiter cannot be spoofed", () => {
		expect(fingerprintFile(makeFile("a:b.png", 1, 0))).toBe("a%3Ab.png:1:0");
	});
});

describe("createUploadSessionStore", () => {
	it("round-trips a session through injected storage", () => {
		const storage = fakeStorage();
		const store = createUploadSessionStore({ storage });
		const file = makeFile("photo.png", 10, 1000);

		expect(store.load(file)).toBeUndefined();
		store.save(file, session);
		expect(store.load(file)).toEqual(session);
	});

	it("namespaces keys under the prefix + fingerprint", () => {
		const storage = fakeStorage();
		const store = createUploadSessionStore({ storage, keyPrefix: "p" });
		const file = makeFile("photo.png", 10, 1000);
		store.save(file, session);
		expect([...storage.map.keys()]).toEqual([`p:${fingerprintFile(file)}`]);
	});

	it("clears a persisted session", () => {
		const storage = fakeStorage();
		const store = createUploadSessionStore({ storage });
		const file = makeFile("photo.png", 10, 1000);
		store.save(file, session);
		store.clear(file);
		expect(store.load(file)).toBeUndefined();
		expect(storage.map.size).toBe(0);
	});

	it("does not resume a different file", () => {
		const storage = fakeStorage();
		const store = createUploadSessionStore({ storage });
		store.save(makeFile("a.png", 10, 1000), session);
		expect(store.load(makeFile("a.png", 99, 1000))).toBeUndefined();
	});

	it("drops a corrupt (non-JSON) entry on load", () => {
		const storage = fakeStorage();
		const store = createUploadSessionStore({ storage });
		const file = makeFile("photo.png", 10, 1000);
		storage.setItem(
			`anvilkit:asset-upload:${fingerprintFile(file)}`,
			"{not json",
		);
		expect(store.load(file)).toBeUndefined();
		expect(storage.map.size).toBe(0);
	});

	it("rejects a structurally invalid persisted shape", () => {
		const storage = fakeStorage();
		const store = createUploadSessionStore({ storage });
		const file = makeFile("photo.png", 10, 1000);
		storage.setItem(
			`anvilkit:asset-upload:${fingerprintFile(file)}`,
			JSON.stringify({ uploadId: "x", partSize: "nope", parts: [] }),
		);
		expect(store.load(file)).toBeUndefined();
	});

	it("swallows storage write failures (resume is best-effort)", () => {
		const throwing: UploadSessionStorage = {
			getItem: () => null,
			setItem: () => {
				throw new Error("QuotaExceededError");
			},
			removeItem: () => undefined,
		};
		const store = createUploadSessionStore({ storage: throwing });
		expect(() => store.save(makeFile("a.png", 1, 0), session)).not.toThrow();
	});

	it("falls back to in-memory storage when localStorage is absent", () => {
		// The node test env has no localStorage, so the default store uses the
		// in-memory fallback — a round-trip still works within the process.
		const store = createUploadSessionStore();
		const file = makeFile("photo.png", 10, 1000);
		store.save(file, session);
		expect(store.load(file)).toEqual(session);
	});

	it("falls back to in-memory when the localStorage probe throws (private mode)", () => {
		const original = Object.getOwnPropertyDescriptor(
			globalThis,
			"localStorage",
		);
		const throwingLs: UploadSessionStorage = {
			getItem: () => null,
			setItem: () => {
				throw new Error("private mode: write denied");
			},
			removeItem: () => undefined,
		};
		Object.defineProperty(globalThis, "localStorage", {
			value: throwingLs,
			configurable: true,
		});
		try {
			// Probe write throws → store must fall back to in-memory, where the
			// round-trip still succeeds (not silently routed to the throwing ls).
			const store = createUploadSessionStore();
			const file = makeFile("photo.png", 10, 1000);
			store.save(file, session);
			expect(store.load(file)).toEqual(session);
		} finally {
			if (original) {
				Object.defineProperty(globalThis, "localStorage", original);
			} else {
				delete (globalThis as { localStorage?: unknown }).localStorage;
			}
		}
	});

	it("rethrows serialization failures (caller contract bug), not just storage errors", () => {
		const storage = fakeStorage();
		const store = createUploadSessionStore({ storage });
		const cyclic = { uploadId: "u", partSize: 8, parts: [] } as Record<
			string,
			unknown
		>;
		cyclic.self = cyclic;
		expect(() =>
			store.save(
				makeFile("a.png", 1, 0),
				cyclic as unknown as PersistedUploadSession,
			),
		).toThrow();
	});
});

describe("createUploadSessionStore validation", () => {
	const file = makeFile("photo.png", 10, 1000);
	const key = `anvilkit:asset-upload:${fingerprintFile(file)}`;
	const valid = {
		uploadId: "u",
		partSize: 8,
		parts: [{ partNumber: 1, etag: "e" }],
	};

	function loadWith(override: Record<string, unknown>) {
		const storage = fakeStorage();
		const store = createUploadSessionStore({ storage });
		storage.setItem(key, JSON.stringify({ ...valid, ...override }));
		return store.load(file);
	}

	it("rejects non-positive or fractional partSize", () => {
		expect(loadWith({ partSize: 0 })).toBeUndefined();
		expect(loadWith({ partSize: -8 })).toBeUndefined();
		expect(loadWith({ partSize: 8.5 })).toBeUndefined();
	});

	it("rejects invalid or missing partNumber", () => {
		expect(loadWith({ parts: [{ partNumber: 0, etag: "e" }] })).toBeUndefined();
		expect(
			loadWith({ parts: [{ partNumber: 1.5, etag: "e" }] }),
		).toBeUndefined();
		expect(loadWith({ parts: [{ etag: "e" }] })).toBeUndefined();
	});

	it("rejects malformed part entries", () => {
		expect(loadWith({ parts: [{ partNumber: 1 }] })).toBeUndefined();
		expect(loadWith({ parts: [null] })).toBeUndefined();
	});

	it("rejects non-object meta", () => {
		expect(loadWith({ meta: [] })).toBeUndefined();
		expect(loadWith({ meta: null })).toBeUndefined();
		expect(loadWith({ meta: 5 })).toBeUndefined();
	});

	it("accepts and round-trips a valid object meta", () => {
		const storage = fakeStorage();
		const store = createUploadSessionStore({ storage });
		const withMeta = { ...valid, meta: { region: "us-east-1", attempt: 2 } };
		storage.setItem(key, JSON.stringify(withMeta));
		expect(store.load(file)).toEqual(withMeta);
	});
});
