/** One shared operation plus independently cancellable callers waiting on it. */
export interface SingleFlight<T> {
	readonly controller: AbortController;
	readonly promise: Promise<T>;
	waiters: number;
	settled: boolean;
}

/** SHA-256 file digest, or `undefined` when the platform cannot hash files. */
export async function computeFileHash(file: File): Promise<string | undefined> {
	const subtle = globalThis.crypto?.subtle;
	if (subtle === undefined || typeof file.arrayBuffer !== "function") {
		return undefined;
	}
	try {
		const digest = await subtle.digest("SHA-256", await file.arrayBuffer());
		const bytes = new Uint8Array(digest);
		let hex = "";
		for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
		return hex;
	} catch {
		return undefined;
	}
}

/** Return the active operation for `key`, or start and track one atomically. */
export function getOrCreateSingleFlight<T>(
	flights: Map<string, SingleFlight<T>>,
	key: string,
	run: (signal: AbortSignal) => Promise<T>,
): SingleFlight<T> {
	const current = flights.get(key);
	if (current !== undefined) return current;

	const controller = new AbortController();
	const flight: SingleFlight<T> = {
		controller,
		promise: run(controller.signal),
		waiters: 0,
		settled: false,
	};
	flights.set(key, flight);
	void flight.promise.then(
		() => settle(flights, key, flight),
		() => settle(flights, key, flight),
	);
	return flight;
}

/**
 * Wait for shared work without coupling it to this caller's cancellation.
 * The underlying operation is aborted only after its final waiter leaves.
 */
export function waitForSingleFlight<T>(
	flight: SingleFlight<T>,
	signal?: AbortSignal,
): Promise<T> {
	flight.waiters += 1;

	return new Promise((resolve, reject) => {
		let released = false;
		const release = (): void => {
			if (released) return;
			released = true;
			signal?.removeEventListener("abort", onAbort);
			flight.waiters -= 1;
			if (flight.waiters === 0 && !flight.settled) {
				flight.controller.abort();
			}
		};
		const onAbort = (): void => {
			release();
			reject(makeAbortError());
		};

		if (signal?.aborted) {
			onAbort();
			return;
		}
		signal?.addEventListener("abort", onAbort, { once: true });
		void flight.promise.then(
			(result) => {
				release();
				resolve(result);
			},
			(error: unknown) => {
				release();
				reject(error);
			},
		);
	});
}

function settle<T>(
	flights: Map<string, SingleFlight<T>>,
	key: string,
	flight: SingleFlight<T>,
): void {
	flight.settled = true;
	if (flights.get(key) === flight) flights.delete(key);
}

function makeAbortError(): Error {
	if (typeof DOMException !== "undefined") {
		return new DOMException("Upload aborted", "AbortError");
	}
	const error = new Error("Upload aborted");
	error.name = "AbortError";
	return error;
}
