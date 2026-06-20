import type { CollectionPlacementInput } from '../shared/websocket-types';
import type { CollectionItem, CollectionItemCreateParams } from './space/protocol';

interface CreatedCollectionOutput {
  assetId: string;
  variantId: string;
}

export function applyCreatedOutputCollectionPlacements(
  placements: CollectionPlacementInput[] | undefined,
  output: CreatedCollectionOutput,
  collectionItems: CollectionItem[],
  addCollectionItem: (params: CollectionItemCreateParams) => void,
  defaultSubjectType: 'asset' | 'variant' = 'asset'
) {
  if (!placements || placements.length === 0) return;
  const createdCounts = new Map<string, number>();

  for (const placement of placements) {
    const subjectType = placement.subjectType ?? defaultSubjectType;
    const existingCount = collectionItems.filter((item) => item.collection_id === placement.collectionId).length;
    const localCount = createdCounts.get(placement.collectionId) ?? 0;
    createdCounts.set(placement.collectionId, localCount + 1);

    addCollectionItem({
      collectionId: placement.collectionId,
      subjectType,
      assetId: subjectType === 'asset' ? output.assetId : undefined,
      variantId: subjectType === 'variant' ? output.variantId : undefined,
      role: placement.role?.trim() || 'custom',
      pinnedVariantId: subjectType === 'asset' && placement.pinToCreatedVariant !== false
        ? output.variantId
        : placement.pinnedVariantId ?? null,
      sortIndex: existingCount + localCount,
    });
  }
}
