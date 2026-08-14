"use client";

import { useMsg } from "@anvilkit/core/i18n";
import { Button } from "@anvilkit/ui/button";
import * as React from "react";

import type {
	AssetCategory,
	AssetFacetDefinition,
	AssetFacetOption,
} from "../types/categories.js";
import type { AssetFilter, AssetSourceId } from "../types/filter.js";
import type { AssetKind, UploadResult } from "../types/types.js";
import { inferAssetKind } from "../utils/infer-kind.js";

type FacetSelections = Readonly<Record<string, readonly string[]>>;

interface TaxonomyBrowserOverrides {
	readonly aboveFilters: React.ReactNode;
	readonly assets: readonly UploadResult[];
	readonly onBaseFilterChange: (filter: AssetFilter) => void;
}

interface AssetTaxonomyFiltersProps {
	readonly aboveFilters?: React.ReactNode;
	readonly assets: readonly UploadResult[];
	readonly categories?: readonly AssetCategory[];
	readonly facets?: readonly AssetFacetDefinition[];
	readonly onFilterChange?: (filter: AssetFilter) => void;
	readonly renderBrowser: (
		overrides: TaxonomyBrowserOverrides,
	) => React.ReactNode;
}

/** Lazy taxonomy-aware wrapper used only when categories/facets are configured. */
export function AssetTaxonomyFilters(props: AssetTaxonomyFiltersProps) {
	const {
		aboveFilters,
		assets,
		categories = [],
		facets = [],
		onFilterChange,
		renderBrowser,
	} = props;
	const msg = useMsg();
	const [activeCategoryId, setActiveCategoryId] = React.useState<
		string | undefined
	>();
	const [activeFacets, setActiveFacets] = React.useState<FacetSelections>({});
	const [baseFilter, setBaseFilter] = React.useState<AssetFilter>({});
	const activeCategory = categories.find(
		(category) => category.id === activeCategoryId,
	);
	const activeSource: AssetSourceId =
		activeCategory?.provider?.source ?? "local";
	const asyncOptions = useAsyncFacetOptions(facets, activeSource);

	const filteredAssets = React.useMemo(
		() =>
			assets.filter(
				(asset) =>
					matchesCategory(asset, activeCategory) &&
					matchesFacets(asset, facets, activeFacets, activeSource),
			),
		[assets, activeCategory, activeFacets, activeSource, facets],
	);

	const emit = React.useCallback(
		(
			nextBase: AssetFilter,
			nextCategory: AssetCategory | undefined,
			nextFacets: FacetSelections,
		) => {
			onFilterChange?.(
				composeFilter(nextBase, nextCategory, nextFacets, facets),
			);
		},
		[facets, onFilterChange],
	);

	const handleBaseFilterChange = React.useCallback(
		(next: AssetFilter) => {
			setBaseFilter(next);
			emit(next, activeCategory, activeFacets);
		},
		[activeCategory, activeFacets, emit],
	);

	const controls = (
		<div data-asset-manager-taxonomy>
			{categories.length > 0 ? (
				<div
					aria-label={msg("assetManager.browser.categoriesLabel", "Categories")}
					role="group"
				>
					{categories.map((category) => {
						const active = category.id === activeCategoryId;
						return (
							<Button
								aria-pressed={active}
								data-asset-category={category.id}
								key={category.id}
								onClick={() => {
									const next = active ? undefined : category;
									setActiveCategoryId(next?.id);
									emit(baseFilter, next, activeFacets);
								}}
								size="sm"
								type="button"
								variant={active ? "secondary" : "ghost"}
							>
								{msg(category.label, category.label)}
							</Button>
						);
					})}
				</div>
			) : null}
			{facets.map((facet) => {
				if (
					facet.remote !== true &&
					facet.appliesTo !== undefined &&
					!facet.appliesTo.includes(activeSource)
				) {
					return null;
				}
				const facetOptions = resolveFacetOptions(
					facet,
					facetSource(facet, activeSource),
					asyncOptions,
				);
				if (facetOptions.length === 0) return null;
				return (
					<div
						aria-label={msg(facet.label, facet.label)}
						data-asset-facet={facet.id}
						key={facet.id}
						role="group"
					>
						{facetOptions.map((option) => {
							const selected = activeFacets[facet.id] ?? [];
							const active = selected.includes(option.value);
							return (
								<Button
									aria-pressed={active}
									data-asset-facet-option={option.value}
									key={option.value}
									onClick={() => {
										const values = toggleFacetOption(
											selected,
											option.value,
											facet.selection,
										);
										const next = { ...activeFacets, [facet.id]: values };
										setActiveFacets(next);
										emit(baseFilter, activeCategory, next);
									}}
									size="sm"
									type="button"
									variant={active ? "secondary" : "ghost"}
								>
									{msg(option.label, option.label)}
								</Button>
							);
						})}
					</div>
				);
			})}
		</div>
	);

	return renderBrowser({
		aboveFilters: (
			<>
				{aboveFilters}
				{controls}
			</>
		),
		assets: filteredAssets,
		onBaseFilterChange: handleBaseFilterChange,
	});
}

function matchesCategory(
	asset: UploadResult,
	category: AssetCategory | undefined,
): boolean {
	if (category === undefined || category.provider !== undefined) return true;
	if (
		category.match?.kinds !== undefined &&
		category.match.kinds.length > 0 &&
		!category.match.kinds.includes(inferAssetKind(asset))
	) {
		return false;
	}
	if (category.match?.tags !== undefined && category.match.tags.length > 0) {
		const tags = new Set(asset.tags ?? []);
		return category.match.tags.every((tag) => tags.has(tag));
	}
	return true;
}

function matchesFacets(
	asset: UploadResult,
	definitions: readonly AssetFacetDefinition[],
	selections: FacetSelections,
	source: AssetSourceId,
): boolean {
	for (const definition of definitions) {
		const selected = selections[definition.id];
		if (
			selected === undefined ||
			selected.length === 0 ||
			definition.remote === true ||
			definition.valueOf === undefined ||
			(definition.appliesTo !== undefined &&
				!definition.appliesTo.includes(source))
		) {
			continue;
		}
		const values = definition.valueOf(asset);
		if (
			values === undefined ||
			!values.some((value) => selected.includes(value))
		) {
			return false;
		}
	}
	return true;
}

function composeFilter(
	base: AssetFilter,
	category: AssetCategory | undefined,
	selections: FacetSelections,
	definitions: readonly AssetFacetDefinition[],
): AssetFilter {
	const categoryKinds = category?.provider ? undefined : category?.match?.kinds;
	const kinds = intersectKinds(base.kinds, categoryKinds);
	const tags = unique([...(base.tags ?? []), ...(category?.match?.tags ?? [])]);
	const source = category?.provider?.source;
	const routedSources = new Set<AssetSourceId>(
		source === undefined ? [] : [source],
	);
	const applicableFacets: Record<string, readonly string[]> = {};
	for (const [id, values] of Object.entries(selections)) {
		if (values.length === 0) continue;
		const definition = definitions.find((facet) => facet.id === id);
		if (
			source !== undefined &&
			definition?.appliesTo !== undefined &&
			!definition.appliesTo.includes(source)
		) {
			continue;
		}
		applicableFacets[id] = values;
		if (source === undefined && definition?.remote === true) {
			for (const applicableSource of definition.appliesTo ?? []) {
				if (applicableSource !== "local") routedSources.add(applicableSource);
			}
		}
	}
	if (source !== undefined && category?.provider?.theme !== undefined) {
		applicableFacets[`${source}:theme`] = [category.provider.theme];
	}

	return {
		...(base.query !== undefined ? { query: base.query } : {}),
		...(kinds.length > 0 ? { kinds } : {}),
		...(tags.length > 0 ? { tags } : {}),
		...(routedSources.size > 0 ? { sources: [...routedSources] } : {}),
		...(Object.keys(applicableFacets).length > 0
			? { facets: applicableFacets }
			: {}),
	};
}

function intersectKinds(
	base: readonly AssetKind[] | undefined,
	category: readonly AssetKind[] | undefined,
): readonly AssetKind[] {
	if (base === undefined || base.length === 0) return category ?? [];
	if (category === undefined || category.length === 0) return base;
	return base.filter((kind) => category.includes(kind));
}

function unique(values: readonly string[]): readonly string[] {
	return [...new Set(values)];
}

function toggleFacetOption(
	selected: readonly string[],
	value: string,
	selection: AssetFacetDefinition["selection"],
): readonly string[] {
	if (selected.includes(value)) {
		return selected.filter((entry) => entry !== value);
	}
	return selection === "single" ? [value] : [...selected, value];
}

type AsyncOptionMap = Readonly<Record<string, readonly AssetFacetOption[]>>;

function asyncOptionKey(id: string, source: AssetSourceId): string {
	return `${id}\u0000${source}`;
}

function useAsyncFacetOptions(
	definitions: readonly AssetFacetDefinition[],
	source: AssetSourceId,
): AsyncOptionMap {
	const [loaded, setLoaded] = React.useState<AsyncOptionMap>({});
	React.useEffect(() => {
		let cancelled = false;
		const loaders = definitions.flatMap((definition) => {
			const optionSource = facetSource(definition, source);
			return typeof definition.options === "function" &&
				(definition.remote === true ||
					definition.appliesTo === undefined ||
					definition.appliesTo.includes(source))
				? [
						Promise.resolve()
							.then(() =>
								typeof definition.options === "function"
									? definition.options({ source: optionSource })
									: [],
							)
							.catch(() => [])
							.then(
								(options) =>
									[
										asyncOptionKey(definition.id, optionSource),
										options,
									] as const,
							),
					]
				: [];
		});
		if (loaders.length === 0) return;
		void Promise.all(loaders).then((entries) => {
			if (cancelled) return;
			setLoaded((current) => ({ ...current, ...Object.fromEntries(entries) }));
		});
		return () => {
			cancelled = true;
		};
	}, [definitions, source]);
	return loaded;
}

function facetSource(
	definition: AssetFacetDefinition,
	activeSource: AssetSourceId,
): AssetSourceId {
	if (
		definition.remote === true &&
		definition.appliesTo !== undefined &&
		!definition.appliesTo.includes(activeSource)
	) {
		return definition.appliesTo[0] ?? activeSource;
	}
	return activeSource;
}

function resolveFacetOptions(
	definition: AssetFacetDefinition,
	source: AssetSourceId,
	loaded: AsyncOptionMap,
): readonly AssetFacetOption[] {
	if (typeof definition.options === "function") {
		return loaded[asyncOptionKey(definition.id, source)] ?? [];
	}
	return definition.options ?? [];
}
