import type { Asset, CollectionItem, SpaceCollection, Variant } from '../../space/protocol';

// Justified-rows packing: each card's width is proportional to its true aspect
// ratio so a row shares one height and fills the available width without
// cropping. Extreme panoramas/strips are clamped so a single asset can't blow
// out a row. Missing dimensions fall back to a square.
export const MIN_CARD_ASPECT = 0.6;
export const MAX_CARD_ASPECT = 2.1;

export function aspectRatioForVariant(variant: Variant | null | undefined): number {
  const width = variant?.media_width ?? null;
  const height = variant?.media_height ?? null;
  if (width && height && width > 0 && height > 0) {
    return Math.min(MAX_CARD_ASPECT, Math.max(MIN_CARD_ASPECT, width / height));
  }
  return 1;
}

export const COLLECTION_KINDS = [
  'cast',
  'backgrounds',
  'scenes',
  'thumbnails',
  'maps',
  'style_refs',
  'deliverables',
  'custom',
] as const;

export const COLLECTION_KIND_LABELS: Record<typeof COLLECTION_KINDS[number], string> = {
  cast: 'Cast',
  backgrounds: 'Backgrounds',
  scenes: 'Scenes',
  thumbnails: 'Thumbnails',
  maps: 'Maps',
  style_refs: 'Style References',
  deliverables: 'Deliverables',
  custom: 'Custom',
};

export const COLLECTION_KIND_COLORS: Record<typeof COLLECTION_KINDS[number], string> = {
  cast: '#4f7cff',
  backgrounds: '#2f9e73',
  scenes: '#c47d25',
  thumbnails: '#b15bd6',
  maps: '#1696a3',
  style_refs: '#d14c6d',
  deliverables: '#737a2a',
  custom: '#6f7480',
};

export function getVisibleCollectionKindLabel(collection: Pick<SpaceCollection, 'kind' | 'name'>): string | null {
  const label = COLLECTION_KIND_LABELS[collection.kind];
  if (collection.kind === 'custom') return null;
  if (label.toLowerCase() === collection.name.toLowerCase()) return null;
  return label;
}

export function sortCollections(collections: SpaceCollection[]): SpaceCollection[] {
  return [...collections].sort((a, b) => a.sort_index - b.sort_index || a.created_at - b.created_at);
}

export function sortCollectionItems(items: CollectionItem[]): CollectionItem[] {
  return [...items].sort((a, b) => a.sort_index - b.sort_index || a.created_at - b.created_at);
}

export function getCollectionItems(collectionId: string, items: CollectionItem[]): CollectionItem[] {
  return sortCollectionItems(items.filter((item) => item.collection_id === collectionId));
}

export function getItemAsset(item: CollectionItem, assets: Asset[], variants: Variant[]): Asset | null {
  if (item.subject_type === 'asset' && item.asset_id) {
    return assets.find((asset) => asset.id === item.asset_id) ?? null;
  }
  if (item.subject_type === 'variant' && item.variant_id) {
    const variant = variants.find((candidate) => candidate.id === item.variant_id);
    return variant ? assets.find((asset) => asset.id === variant.asset_id) ?? null : null;
  }
  return null;
}

export function getDisplayVariant(item: CollectionItem | null, asset: Asset, variants: Variant[]): Variant | null {
  if (item?.subject_type === 'variant' && item.variant_id) {
    return variants.find((variant) => variant.id === item.variant_id) ?? null;
  }
  if (item?.pinned_variant_id) {
    return variants.find((variant) => variant.id === item.pinned_variant_id) ?? null;
  }
  if (asset.active_variant_id) {
    const active = variants.find((variant) => variant.id === asset.active_variant_id);
    if (active) return active;
  }
  return variants.find((variant) => variant.asset_id === asset.id) ?? null;
}

export function getPinnedVariantIdForAssetCollection(
  collection: SpaceCollection | null | undefined,
  asset: Asset | null | undefined,
): string | null {
  if (collection?.kind !== 'style_refs') return null;
  return asset?.active_variant_id ?? null;
}

export function getUnfiledAssets(assets: Asset[], items: CollectionItem[], variants: Variant[] = []): Asset[] {
  const filedAssetIds = new Set<string>();
  for (const item of items) {
    if (item.subject_type === 'asset' && item.asset_id) {
      filedAssetIds.add(item.asset_id);
    } else if (item.subject_type === 'variant' && item.variant_id) {
      const variant = variants.find((candidate) => candidate.id === item.variant_id);
      if (variant) filedAssetIds.add(variant.asset_id);
    }
  }
  return assets.filter((asset) => !filedAssetIds.has(asset.id));
}

export function moveId(ids: string[], id: string, direction: -1 | 1): string[] {
  const index = ids.indexOf(id);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= ids.length) return ids;
  const next = [...ids];
  [next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!];
  return next;
}
