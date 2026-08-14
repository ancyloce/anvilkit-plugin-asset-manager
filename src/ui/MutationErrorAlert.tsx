"use client";

import * as React from "react";

/** Turn an arbitrary callback rejection into safe, actionable UI copy. */
export function mutationErrorMessage(
	cause: unknown,
	retryMessage: string,
): string {
	let detail = "";
	if (cause instanceof Error) {
		detail = cause.message.trim();
	} else if (typeof cause === "string") {
		detail = cause.trim();
	}
	return detail === "" ? retryMessage : `${detail} ${retryMessage}`;
}

/** Consistent live-region presentation for rejected dialog mutations. */
export function MutationErrorAlert({
	message,
}: {
	readonly message: string | null;
}) {
	if (message === null) return null;
	return (
		<p
			role="alert"
			className="text-sm text-[var(--ak-studio-danger-fg,#dc2626)]"
			data-asset-manager-mutation-error
		>
			{message}
		</p>
	);
}
