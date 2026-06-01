import { describe, expect, it } from "vitest";

import {
	AssetSourceError,
	type AssetSourceErrorCode,
} from "../utils/errors.js";

describe("AssetSourceError", () => {
	it("is an Error subclass with the expected name and code", () => {
		const error = new AssetSourceError(
			"DATA_SOURCE_UNAVAILABLE",
			"list failed",
		);
		expect(error).toBeInstanceOf(Error);
		expect(error.name).toBe("AssetSourceError");
		expect(error.code).toBe("DATA_SOURCE_UNAVAILABLE");
		expect(error.message).toBe("list failed");
	});

	it("defaults retryable to false and leaves status/retryAfterMs undefined", () => {
		const error = new AssetSourceError("FOLDER_CYCLE", "would cycle");
		expect(error.retryable).toBe(false);
		expect(error.status).toBeUndefined();
		expect(error.retryAfterMs).toBeUndefined();
	});

	it("carries retry metadata for a rate-limited provider", () => {
		const error = new AssetSourceError("PROVIDER_RATE_LIMITED", "429", {
			retryable: true,
			status: 429,
			retryAfterMs: 38_000,
		});
		expect(error.retryable).toBe(true);
		expect(error.status).toBe(429);
		expect(error.retryAfterMs).toBe(38_000);
	});

	it("threads the cause when supplied", () => {
		const cause = new Error("socket hung up");
		const error = new AssetSourceError("PROVIDER_NETWORK", "network", {
			retryable: true,
			cause,
		});
		expect(error.cause).toBe(cause);
	});

	it("accepts every documented error code", () => {
		const codes: readonly AssetSourceErrorCode[] = [
			"DATA_SOURCE_UNAVAILABLE",
			"DATA_SOURCE_TIMEOUT",
			"ASSET_MUTATION_REJECTED",
			"FOLDER_NOT_FOUND",
			"FOLDER_CYCLE",
			"FOLDER_NAME_CONFLICT",
			"FOLDER_NOT_EMPTY",
			"MOVE_REJECTED",
			"PROVIDER_RATE_LIMITED",
			"PROVIDER_UNAUTHORIZED",
			"PROVIDER_NETWORK",
			"PROVIDER_BAD_RESPONSE",
			"READ_ONLY_SOURCE",
			"OPTIMISTIC_ROLLBACK",
		];
		for (const code of codes) {
			expect(new AssetSourceError(code, code).code).toBe(code);
		}
	});
});
