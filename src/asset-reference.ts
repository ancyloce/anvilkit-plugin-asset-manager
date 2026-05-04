/**
 * @file Canonical `asset://${id}` reference helper.
 *
 * Lives in its own file so both `plugin.ts` (which dispatches asset
 * references into Puck data) and `studio-asset-source.ts` (which
 * surfaces the URL to the sidebar's `image` module) can reuse it
 * without creating a circular import between them.
 */

export function createAssetReference(id: string): string {
	return `asset://${id}`;
}
