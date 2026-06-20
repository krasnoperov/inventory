import type {
  CollectionItem,
  CollectionKind,
  Composition,
  CompositionItem,
  CompositionItemRole,
  CompositionStatus,
  SpaceCollection,
  SpaceRelation,
  SpaceRelationType,
  SpaceSubjectType,
  WebSocketMeta,
} from '../types';
import { BaseController, type ControllerContext, NotFoundError, ValidationError } from './types';

const RELATION_TYPES = new Set<SpaceRelationType>([
  'appears_in',
  'background_for',
  'style_reference_for',
  'thumbnail_for',
  'alternate_of',
  'prop_in',
  'map_for',
  'part_of',
  'reference_for',
  'custom',
]);

const COMPOSITION_ROLES = new Set<CompositionItemRole>([
  'output',
  'background',
  'character',
  'prop',
  'style_ref',
  'overlay',
  'map',
  'thumbnail',
  'custom',
]);

const COMPOSITION_STATUSES = new Set<CompositionStatus>(['draft', 'final']);

const COLLECTION_KINDS = new Set<CollectionKind>([
  'cast',
  'style_refs',
  'backgrounds',
  'scenes',
  'thumbnails',
  'maps',
  'deliverables',
  'custom',
]);

interface SubjectInput {
  subjectType?: unknown;
  assetId?: unknown;
  variantId?: unknown;
}

interface CollectionInput {
  id?: unknown;
  name?: unknown;
  kind?: unknown;
  color?: unknown;
  description?: unknown;
  sortIndex?: unknown;
  createdBy?: unknown;
}

interface CollectionUpdateInput {
  name?: unknown;
  kind?: unknown;
  color?: unknown;
  description?: unknown;
  sortIndex?: unknown;
}

interface CollectionItemInput extends SubjectInput {
  id?: unknown;
  role?: unknown;
  pinnedVariantId?: unknown;
  sortIndex?: unknown;
  createdBy?: unknown;
}

interface CollectionItemUpdateInput {
  role?: unknown;
  pinnedVariantId?: unknown;
  sortIndex?: unknown;
}

interface RelationInput {
  id?: unknown;
  subject?: SubjectInput;
  object?: SubjectInput;
  relationType?: unknown;
  label?: unknown;
  context?: unknown;
  metadata?: unknown;
  sortIndex?: unknown;
  createdBy?: unknown;
}

interface RelationUpdateInput {
  relationType?: unknown;
  label?: unknown;
  context?: unknown;
  metadata?: unknown;
  sortIndex?: unknown;
}

interface CompositionInput {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  status?: unknown;
  outputAssetId?: unknown;
  outputVariantId?: unknown;
  metadata?: unknown;
  sortIndex?: unknown;
  createdBy?: unknown;
}

interface CompositionUpdateInput {
  name?: unknown;
  description?: unknown;
  status?: unknown;
  outputAssetId?: unknown;
  outputVariantId?: unknown;
  metadata?: unknown;
  sortIndex?: unknown;
}

interface CompositionItemInput {
  id?: unknown;
  role?: unknown;
  label?: unknown;
  assetId?: unknown;
  variantId?: unknown;
  metadata?: unknown;
  sortIndex?: unknown;
  createdBy?: unknown;
}

interface CompositionItemUpdateInput {
  role?: unknown;
  label?: unknown;
  assetId?: unknown;
  variantId?: unknown;
  metadata?: unknown;
  sortIndex?: unknown;
}

interface ParentHierarchyBackfillInput {
  createManualRelations?: unknown;
  createStarterCollectionsForAllNullParents?: unknown;
  createdBy?: unknown;
}

export class OrganizationController extends BaseController {
  constructor(ctx: ControllerContext) {
    super(ctx);
  }

  async httpListCollections(): Promise<SpaceCollection[]> {
    return this.repo.listCollections();
  }

  async httpCreateCollection(data: CollectionInput): Promise<SpaceCollection> {
    const collection = await this.createCollection(data);
    this.broadcast({ type: 'collection:created', collection });
    return collection;
  }

  async httpUpdateCollection(collectionId: string, data: CollectionUpdateInput): Promise<SpaceCollection> {
    const collection = await this.updateCollection(collectionId, data);
    this.broadcast({ type: 'collection:updated', collection });
    await this.broadcastStylePresetPreviewsForCollections([collection.id]);
    return collection;
  }

  async httpDeleteCollection(collectionId: string): Promise<void> {
    const affectedPresets = await this.repo.listStylePresetPreviewsByCollection(collectionId);
    await this.deleteCollection(collectionId);
    this.broadcast({ type: 'collection:deleted', collectionId });
    await this.broadcastStylePresetPreviewsByIds(affectedPresets.map((preset) => preset.id));
  }

  async httpListCollectionItems(collectionId: string): Promise<CollectionItem[]> {
    await this.getExistingCollection(collectionId);
    return this.repo.listCollectionItems(collectionId);
  }

  async httpCreateCollectionItem(collectionId: string, data: CollectionItemInput): Promise<CollectionItem> {
    const item = await this.createCollectionItem(collectionId, data);
    this.broadcast({ type: 'collection_item:created', item });
    await this.broadcastStylePresetPreviewsForCollections([item.collection_id]);
    return item;
  }

  async httpUpdateCollectionItem(collectionId: string, itemId: string, data: CollectionItemUpdateInput): Promise<CollectionItem> {
    const item = await this.updateCollectionItem(collectionId, itemId, data);
    this.broadcast({ type: 'collection_item:updated', item });
    await this.broadcastStylePresetPreviewsForCollections([item.collection_id]);
    return item;
  }

  async httpReorderCollectionItems(collectionId: string, itemIds: unknown): Promise<CollectionItem[]> {
    const items = await this.reorderCollectionItems(collectionId, itemIds);
    this.broadcast({ type: 'collection_items:reordered', collectionId, items });
    await this.broadcastStylePresetPreviewsForCollections([collectionId]);
    return items;
  }

  async httpDeleteCollectionItem(collectionId: string, itemId: string): Promise<void> {
    await this.deleteCollectionItem(collectionId, itemId);
    this.broadcast({ type: 'collection_item:deleted', collectionId, itemId });
    await this.broadcastStylePresetPreviewsForCollections([collectionId]);
  }

  async httpListRelations(): Promise<SpaceRelation[]> {
    return this.repo.listRelations();
  }

  async httpCreateRelation(data: RelationInput): Promise<SpaceRelation> {
    const relation = await this.createRelation(data);
    this.broadcast({ type: 'relation:created', relation });
    return relation;
  }

  async httpUpdateRelation(relationId: string, data: RelationUpdateInput): Promise<SpaceRelation> {
    const relation = await this.updateRelation(relationId, data);
    this.broadcast({ type: 'relation:updated', relation });
    return relation;
  }

  async httpDeleteRelation(relationId: string): Promise<void> {
    await this.deleteRelation(relationId);
    this.broadcast({ type: 'relation:deleted', relationId });
  }

  async httpBackfillParentHierarchy(input: unknown = {}) {
    const data = normalizeBackfillInput(input);
    const [beforeCollections, beforeItems, beforeRelations] = await Promise.all([
      this.repo.listCollections(),
      this.repo.listAllCollectionItems(),
      this.repo.listRelations(),
    ]);
    const result = await this.repo.backfillParentHierarchyToOrganization({
      createManualRelations: normalizeOptionalBoolean(data.createManualRelations),
      createStarterCollectionsForAllNullParents: normalizeOptionalBoolean(data.createStarterCollectionsForAllNullParents),
      createdBy: normalizeOptionalString(data.createdBy) ?? undefined,
    });

    if (
      result.collectionsCreated === 0 &&
      result.collectionItemsCreated === 0 &&
      result.relationsCreated === 0
    ) {
      return result;
    }

    const beforeCollectionIds = new Set(beforeCollections.map((collection) => collection.id));
    const beforeItemIds = new Set(beforeItems.map((item) => item.id));
    const beforeRelationIds = new Set(beforeRelations.map((relation) => relation.id));
    const [afterCollections, afterItems, afterRelations] = await Promise.all([
      this.repo.listCollections(),
      this.repo.listAllCollectionItems(),
      this.repo.listRelations(),
    ]);

    for (const collection of afterCollections) {
      if (!beforeCollectionIds.has(collection.id)) {
        this.broadcast({ type: 'collection:created', collection });
      }
    }
    for (const item of afterItems) {
      if (!beforeItemIds.has(item.id)) {
        this.broadcast({ type: 'collection_item:created', item });
      }
    }
    for (const relation of afterRelations) {
      if (!beforeRelationIds.has(relation.id)) {
        this.broadcast({ type: 'relation:created', relation });
      }
    }

    return result;
  }

  async httpListCompositions(): Promise<Composition[]> {
    return this.repo.listCompositions();
  }

  async httpCreateComposition(data: CompositionInput): Promise<Composition> {
    const composition = await this.createComposition(data);
    this.broadcast({ type: 'composition:created', composition });
    return composition;
  }

  async httpUpdateComposition(compositionId: string, data: CompositionUpdateInput): Promise<Composition> {
    const composition = await this.updateComposition(compositionId, data);
    this.broadcast({ type: 'composition:updated', composition });
    return composition;
  }

  async httpDeleteComposition(compositionId: string): Promise<void> {
    await this.deleteComposition(compositionId);
    this.broadcast({ type: 'composition:deleted', compositionId });
  }

  async httpListCompositionItems(compositionId: string): Promise<CompositionItem[]> {
    await this.getExistingComposition(compositionId);
    return this.repo.listCompositionItems(compositionId);
  }

  async httpCreateCompositionItem(compositionId: string, data: CompositionItemInput): Promise<CompositionItem> {
    const item = await this.createCompositionItem(compositionId, data);
    this.broadcast({ type: 'composition_item:created', item });
    return item;
  }

  async httpUpdateCompositionItem(compositionId: string, itemId: string, data: CompositionItemUpdateInput): Promise<CompositionItem> {
    const item = await this.updateCompositionItem(compositionId, itemId, data);
    this.broadcast({ type: 'composition_item:updated', item });
    return item;
  }

  async httpReorderCompositionItems(compositionId: string, itemIds: unknown): Promise<CompositionItem[]> {
    const items = await this.reorderCompositionItems(compositionId, itemIds);
    this.broadcast({ type: 'composition_items:reordered', compositionId, items });
    return items;
  }

  async httpDeleteCompositionItem(compositionId: string, itemId: string): Promise<void> {
    await this.deleteCompositionItem(compositionId, itemId);
    this.broadcast({ type: 'composition_item:deleted', compositionId, itemId });
  }

  async handleCreateCollection(_ws: WebSocket, meta: WebSocketMeta, data: CollectionInput): Promise<void> {
    this.requireEditor(meta);
    const collection = await this.createCollection({ ...data, createdBy: meta.userId });
    this.broadcast({ type: 'collection:created', collection });
  }

  async handleUpdateCollection(_ws: WebSocket, meta: WebSocketMeta, collectionId: string, data: CollectionUpdateInput): Promise<void> {
    this.requireEditor(meta);
    const collection = await this.updateCollection(collectionId, data);
    this.broadcast({ type: 'collection:updated', collection });
    await this.broadcastStylePresetPreviewsForCollections([collection.id]);
  }

  async handleDeleteCollection(_ws: WebSocket, meta: WebSocketMeta, collectionId: string): Promise<void> {
    this.requireEditor(meta);
    const affectedPresets = await this.repo.listStylePresetPreviewsByCollection(collectionId);
    await this.deleteCollection(collectionId);
    this.broadcast({ type: 'collection:deleted', collectionId });
    await this.broadcastStylePresetPreviewsByIds(affectedPresets.map((preset) => preset.id));
  }

  async handleCreateCollectionItem(_ws: WebSocket, meta: WebSocketMeta, collectionId: string, data: CollectionItemInput): Promise<void> {
    this.requireEditor(meta);
    const item = await this.createCollectionItem(collectionId, { ...data, createdBy: meta.userId });
    this.broadcast({ type: 'collection_item:created', item });
    await this.broadcastStylePresetPreviewsForCollections([item.collection_id]);
  }

  async handleUpdateCollectionItem(_ws: WebSocket, meta: WebSocketMeta, collectionId: string, itemId: string, data: CollectionItemUpdateInput): Promise<void> {
    this.requireEditor(meta);
    const item = await this.updateCollectionItem(collectionId, itemId, data);
    this.broadcast({ type: 'collection_item:updated', item });
    await this.broadcastStylePresetPreviewsForCollections([item.collection_id]);
  }

  async handleReorderCollectionItems(_ws: WebSocket, meta: WebSocketMeta, collectionId: string, itemIds: unknown): Promise<void> {
    this.requireEditor(meta);
    const items = await this.reorderCollectionItems(collectionId, itemIds);
    this.broadcast({ type: 'collection_items:reordered', collectionId, items });
    await this.broadcastStylePresetPreviewsForCollections([collectionId]);
  }

  async handleDeleteCollectionItem(_ws: WebSocket, meta: WebSocketMeta, collectionId: string, itemId: string): Promise<void> {
    this.requireEditor(meta);
    await this.deleteCollectionItem(collectionId, itemId);
    this.broadcast({ type: 'collection_item:deleted', collectionId, itemId });
    await this.broadcastStylePresetPreviewsForCollections([collectionId]);
  }

  async handleCreateRelation(_ws: WebSocket, meta: WebSocketMeta, data: RelationInput): Promise<void> {
    this.requireEditor(meta);
    const relation = await this.createRelation({ ...data, createdBy: meta.userId });
    this.broadcast({ type: 'relation:created', relation });
  }

  async handleUpdateRelation(_ws: WebSocket, meta: WebSocketMeta, relationId: string, data: RelationUpdateInput): Promise<void> {
    this.requireEditor(meta);
    const relation = await this.updateRelation(relationId, data);
    this.broadcast({ type: 'relation:updated', relation });
  }

  async handleDeleteRelation(_ws: WebSocket, meta: WebSocketMeta, relationId: string): Promise<void> {
    this.requireEditor(meta);
    await this.deleteRelation(relationId);
    this.broadcast({ type: 'relation:deleted', relationId });
  }

  async handleCreateComposition(_ws: WebSocket, meta: WebSocketMeta, data: CompositionInput): Promise<void> {
    this.requireEditor(meta);
    const composition = await this.createComposition({ ...data, createdBy: meta.userId });
    this.broadcast({ type: 'composition:created', composition });
  }

  async handleUpdateComposition(_ws: WebSocket, meta: WebSocketMeta, compositionId: string, data: CompositionUpdateInput): Promise<void> {
    this.requireEditor(meta);
    const composition = await this.updateComposition(compositionId, data);
    this.broadcast({ type: 'composition:updated', composition });
  }

  async handleDeleteComposition(_ws: WebSocket, meta: WebSocketMeta, compositionId: string): Promise<void> {
    this.requireEditor(meta);
    await this.deleteComposition(compositionId);
    this.broadcast({ type: 'composition:deleted', compositionId });
  }

  async handleCreateCompositionItem(_ws: WebSocket, meta: WebSocketMeta, compositionId: string, data: CompositionItemInput): Promise<void> {
    this.requireEditor(meta);
    const item = await this.createCompositionItem(compositionId, { ...data, createdBy: meta.userId });
    this.broadcast({ type: 'composition_item:created', item });
  }

  async handleUpdateCompositionItem(_ws: WebSocket, meta: WebSocketMeta, compositionId: string, itemId: string, data: CompositionItemUpdateInput): Promise<void> {
    this.requireEditor(meta);
    const item = await this.updateCompositionItem(compositionId, itemId, data);
    this.broadcast({ type: 'composition_item:updated', item });
  }

  async handleReorderCompositionItems(_ws: WebSocket, meta: WebSocketMeta, compositionId: string, itemIds: unknown): Promise<void> {
    this.requireEditor(meta);
    const items = await this.reorderCompositionItems(compositionId, itemIds);
    this.broadcast({ type: 'composition_items:reordered', compositionId, items });
  }

  async handleDeleteCompositionItem(_ws: WebSocket, meta: WebSocketMeta, compositionId: string, itemId: string): Promise<void> {
    this.requireEditor(meta);
    await this.deleteCompositionItem(compositionId, itemId);
    this.broadcast({ type: 'composition_item:deleted', compositionId, itemId });
  }

  private async createCollection(data: CollectionInput): Promise<SpaceCollection> {
    const name = normalizeRequiredString(data.name, 'name');
    const createdBy = normalizeRequiredString(data.createdBy, 'createdBy');
    return this.repo.createCollection({
      id: normalizeOptionalString(data.id) ?? crypto.randomUUID(),
      name,
      kind: data.kind === undefined ? 'custom' : normalizeCollectionKind(data.kind),
      color: normalizeCollectionColor(data.color),
      description: normalizeOptionalString(data.description),
      sortIndex: normalizeOptionalInteger(data.sortIndex, 'sortIndex') ?? 0,
      createdBy,
    });
  }

  private async updateCollection(collectionId: string, data: CollectionUpdateInput): Promise<SpaceCollection> {
    const collection = await this.repo.updateCollection(normalizeRequiredString(collectionId, 'collectionId'), {
      name: data.name === undefined ? undefined : normalizeRequiredString(data.name, 'name'),
      kind: data.kind === undefined ? undefined : normalizeCollectionKind(data.kind),
      color: data.color === undefined ? undefined : normalizeCollectionColor(data.color),
      description: data.description === undefined ? undefined : normalizeOptionalString(data.description),
      sortIndex: data.sortIndex === undefined ? undefined : normalizeInteger(data.sortIndex, 'sortIndex'),
    });
    if (!collection) {
      throw new NotFoundError('Collection not found');
    }
    return collection;
  }

  private async deleteCollection(collectionId: string): Promise<void> {
    const deleted = await this.repo.deleteCollection(normalizeRequiredString(collectionId, 'collectionId'));
    if (!deleted) {
      throw new NotFoundError('Collection not found');
    }
  }

  private async createCollectionItem(collectionId: string, data: CollectionItemInput): Promise<CollectionItem> {
    await this.getExistingCollection(collectionId);
    const subject = await this.normalizeAndValidateSubject(data);
    const pinnedVariantId = await this.normalizePinnedVariantId(data.pinnedVariantId, subject);
    return this.repo.createCollectionItem({
      id: normalizeOptionalString(data.id) ?? crypto.randomUUID(),
      collectionId,
      ...subject,
      role: normalizeOptionalString(data.role) ?? 'custom',
      pinnedVariantId,
      sortIndex: normalizeOptionalInteger(data.sortIndex, 'sortIndex') ?? 0,
      createdBy: normalizeRequiredString(data.createdBy, 'createdBy'),
    });
  }

  private async updateCollectionItem(collectionId: string, itemId: string, data: CollectionItemUpdateInput): Promise<CollectionItem> {
    const existing = await this.getExistingCollectionItem(collectionId, itemId);
    const pinnedVariantId = data.pinnedVariantId === undefined
      ? undefined
      : await this.normalizePinnedVariantId(data.pinnedVariantId, {
        subjectType: existing.subject_type,
        assetId: existing.asset_id ?? undefined,
        variantId: existing.variant_id ?? undefined,
      });
    const item = await this.repo.updateCollectionItem(existing.id, {
      role: data.role === undefined ? undefined : normalizeOptionalString(data.role) ?? 'custom',
      pinnedVariantId,
      sortIndex: data.sortIndex === undefined ? undefined : normalizeInteger(data.sortIndex, 'sortIndex'),
    });
    if (!item) {
      throw new NotFoundError('Collection item not found');
    }
    return item;
  }

  private async reorderCollectionItems(collectionId: string, itemIdsValue: unknown): Promise<CollectionItem[]> {
    await this.getExistingCollection(collectionId);
    const itemIds = normalizeIdArray(itemIdsValue, 'itemIds');
    const existing = await this.repo.listCollectionItems(collectionId);
    const existingIds = new Set(existing.map((item) => item.id));
    if (itemIds.some((itemId) => !existingIds.has(itemId))) {
      throw new NotFoundError('Collection item not found');
    }
    return this.repo.reorderCollectionItems(collectionId, itemIds);
  }

  private async deleteCollectionItem(collectionId: string, itemId: string): Promise<void> {
    const existing = await this.getExistingCollectionItem(collectionId, itemId);
    const deleted = await this.repo.deleteCollectionItem(existing.id);
    if (!deleted) {
      throw new NotFoundError('Collection item not found');
    }
  }

  private async createRelation(data: RelationInput): Promise<SpaceRelation> {
    const subject = await this.normalizeAndValidateSubject(data.subject);
    const object = await this.normalizeAndValidateSubject(data.object);
    return this.repo.createRelation({
      id: normalizeOptionalString(data.id) ?? crypto.randomUUID(),
      subject,
      object,
      relationType: normalizeRelationType(data.relationType),
      label: normalizeOptionalString(data.label),
      context: data.context === undefined ? null : normalizeNullableStringOrJson(data.context, 'context'),
      metadata: normalizeMetadata(data.metadata),
      sortIndex: normalizeOptionalInteger(data.sortIndex, 'sortIndex') ?? 0,
      createdBy: normalizeRequiredString(data.createdBy, 'createdBy'),
    });
  }

  private async updateRelation(relationId: string, data: RelationUpdateInput): Promise<SpaceRelation> {
    const relation = await this.repo.updateRelation(normalizeRequiredString(relationId, 'relationId'), {
      relationType: data.relationType === undefined ? undefined : normalizeRelationType(data.relationType),
      label: data.label === undefined ? undefined : normalizeOptionalString(data.label),
      context: data.context === undefined ? undefined : normalizeNullableStringOrJson(data.context, 'context'),
      metadata: data.metadata === undefined ? undefined : normalizeMetadata(data.metadata),
      sortIndex: data.sortIndex === undefined ? undefined : normalizeInteger(data.sortIndex, 'sortIndex'),
    });
    if (!relation) {
      throw new NotFoundError('Relation not found');
    }
    return relation;
  }

  private async deleteRelation(relationId: string): Promise<void> {
    const deleted = await this.repo.deleteRelation(normalizeRequiredString(relationId, 'relationId'));
    if (!deleted) {
      throw new NotFoundError('Relation not found');
    }
  }

  private async createComposition(data: CompositionInput): Promise<Composition> {
    const output = await this.normalizeCompositionOutput(data.outputAssetId, data.outputVariantId);
    return this.repo.createComposition({
      id: normalizeOptionalString(data.id) ?? crypto.randomUUID(),
      name: normalizeRequiredString(data.name, 'name'),
      description: normalizeOptionalString(data.description),
      status: data.status === undefined ? 'draft' : normalizeCompositionStatus(data.status),
      outputAssetId: output.outputAssetId,
      outputVariantId: output.outputVariantId,
      metadata: normalizeMetadata(data.metadata),
      sortIndex: normalizeOptionalInteger(data.sortIndex, 'sortIndex') ?? 0,
      createdBy: normalizeRequiredString(data.createdBy, 'createdBy'),
    });
  }

  private async updateComposition(compositionId: string, data: CompositionUpdateInput): Promise<Composition> {
    await this.getExistingComposition(compositionId);
    const output: { outputAssetId?: string | null; outputVariantId?: string | null } =
      data.outputAssetId === undefined && data.outputVariantId === undefined
      ? {}
      : await this.normalizeCompositionOutput(data.outputAssetId, data.outputVariantId);
    const composition = await this.repo.updateComposition(compositionId, {
      name: data.name === undefined ? undefined : normalizeRequiredString(data.name, 'name'),
      description: data.description === undefined ? undefined : normalizeOptionalString(data.description),
      status: data.status === undefined ? undefined : normalizeCompositionStatus(data.status),
      outputAssetId: data.outputAssetId === undefined && data.outputVariantId === undefined ? undefined : output.outputAssetId,
      outputVariantId: data.outputAssetId === undefined && data.outputVariantId === undefined ? undefined : output.outputVariantId,
      metadata: data.metadata === undefined ? undefined : normalizeMetadata(data.metadata),
      sortIndex: data.sortIndex === undefined ? undefined : normalizeInteger(data.sortIndex, 'sortIndex'),
    });
    if (!composition) {
      throw new NotFoundError('Composition not found');
    }
    return composition;
  }

  private async deleteComposition(compositionId: string): Promise<void> {
    const deleted = await this.repo.deleteComposition(normalizeRequiredString(compositionId, 'compositionId'));
    if (!deleted) {
      throw new NotFoundError('Composition not found');
    }
  }

  private async createCompositionItem(compositionId: string, data: CompositionItemInput): Promise<CompositionItem> {
    await this.getExistingComposition(compositionId);
    const variant = await this.getExistingVariant(normalizeRequiredString(data.variantId, 'variantId'));
    const assetId = await this.normalizeCompositionItemAsset(data.assetId, variant.asset_id);
    return this.repo.createCompositionItem({
      id: normalizeOptionalString(data.id) ?? crypto.randomUUID(),
      compositionId,
      role: normalizeCompositionRole(data.role),
      label: normalizeOptionalString(data.label),
      variantId: variant.id,
      assetId,
      metadata: normalizeMetadata(data.metadata),
      sortIndex: normalizeOptionalInteger(data.sortIndex, 'sortIndex') ?? 0,
      createdBy: normalizeRequiredString(data.createdBy, 'createdBy'),
    });
  }

  private async updateCompositionItem(compositionId: string, itemId: string, data: CompositionItemUpdateInput): Promise<CompositionItem> {
    const existing = await this.getExistingCompositionItem(compositionId, itemId);
    const variant = data.variantId === undefined
      ? null
      : await this.getExistingVariant(normalizeRequiredString(data.variantId, 'variantId'));
    const referenceAssetId = variant?.asset_id ?? existing.asset_id ?? undefined;
    const assetId = data.assetId === undefined
      ? variant?.asset_id
      : await this.normalizeCompositionItemAsset(data.assetId, referenceAssetId);
    const item = await this.repo.updateCompositionItem(existing.id, {
      role: data.role === undefined ? undefined : normalizeCompositionRole(data.role),
      label: data.label === undefined ? undefined : normalizeOptionalString(data.label),
      variantId: variant?.id,
      assetId,
      metadata: data.metadata === undefined ? undefined : normalizeMetadata(data.metadata),
      sortIndex: data.sortIndex === undefined ? undefined : normalizeInteger(data.sortIndex, 'sortIndex'),
    });
    if (!item) {
      throw new NotFoundError('Composition item not found');
    }
    return item;
  }

  private async reorderCompositionItems(compositionId: string, itemIdsValue: unknown): Promise<CompositionItem[]> {
    await this.getExistingComposition(compositionId);
    const itemIds = normalizeIdArray(itemIdsValue, 'itemIds');
    const existing = await this.repo.listCompositionItems(compositionId);
    const existingIds = new Set(existing.map((item) => item.id));
    if (itemIds.some((itemId) => !existingIds.has(itemId))) {
      throw new NotFoundError('Composition item not found');
    }
    return this.repo.reorderCompositionItems(compositionId, itemIds);
  }

  private async deleteCompositionItem(compositionId: string, itemId: string): Promise<void> {
    const existing = await this.getExistingCompositionItem(compositionId, itemId);
    const deleted = await this.repo.deleteCompositionItem(existing.id);
    if (!deleted) {
      throw new NotFoundError('Composition item not found');
    }
  }

  private async normalizeAndValidateSubject(value: SubjectInput | undefined): Promise<{
    subjectType: SpaceSubjectType;
    assetId?: string;
    variantId?: string;
  }> {
    if (!value || typeof value !== 'object') {
      throw new ValidationError('Subject is required');
    }
    const subjectType = normalizeSubjectType(value.subjectType);
    if (subjectType === 'asset') {
      const assetId = normalizeRequiredString(value.assetId, 'assetId');
      const asset = await this.repo.getAssetById(assetId);
      if (!asset) {
        throw new NotFoundError('Subject not found');
      }
      return { subjectType, assetId };
    }

    const variantId = normalizeRequiredString(value.variantId, 'variantId');
    const variant = await this.repo.getVariantById(variantId);
    if (!variant) {
      throw new NotFoundError('Subject not found');
    }
    return { subjectType, variantId };
  }

  private async normalizePinnedVariantId(value: unknown, subject: {
    subjectType: SpaceSubjectType;
    assetId?: string;
    variantId?: string;
  }): Promise<string | null> {
    const variantId = normalizeOptionalString(value);
    if (!variantId) return null;
    const variant = await this.repo.getVariantById(variantId);
    if (!variant) {
      throw new NotFoundError('Subject not found');
    }
    if (subject.subjectType === 'asset' && variant.asset_id !== subject.assetId) {
      throw new ValidationError('pinnedVariantId must reference a variant on the asset subject');
    }
    return variant.id;
  }

  private async normalizeCompositionOutput(outputAssetValue: unknown, outputVariantValue: unknown): Promise<{
    outputAssetId: string | null;
    outputVariantId: string | null;
  }> {
    const outputAssetId = normalizeOptionalString(outputAssetValue);
    const outputVariantId = normalizeOptionalString(outputVariantValue);
    if (outputAssetId) {
      const asset = await this.repo.getAssetById(outputAssetId);
      if (!asset) {
        throw new NotFoundError('Subject not found');
      }
    }
    if (outputVariantId) {
      const variant = await this.repo.getVariantById(outputVariantId);
      if (!variant) {
        throw new NotFoundError('Subject not found');
      }
      if (outputAssetId && variant.asset_id !== outputAssetId) {
        throw new ValidationError('outputVariantId must belong to outputAssetId');
      }
      return { outputAssetId: outputAssetId ?? variant.asset_id, outputVariantId };
    }
    return { outputAssetId: outputAssetId ?? null, outputVariantId: null };
  }

  private async normalizeCompositionItemAsset(value: unknown, variantAssetId?: string): Promise<string | null> {
    const assetId = normalizeOptionalString(value) ?? variantAssetId ?? null;
    if (!assetId) return null;
    const asset = await this.repo.getAssetById(assetId);
    if (!asset) {
      throw new NotFoundError('Subject not found');
    }
    if (variantAssetId && assetId !== variantAssetId) {
      throw new ValidationError('assetId must match the variant asset');
    }
    return assetId;
  }

  private async getExistingCollection(collectionId: string): Promise<SpaceCollection> {
    const collection = await this.repo.getCollectionById(normalizeRequiredString(collectionId, 'collectionId'));
    if (!collection) {
      throw new NotFoundError('Collection not found');
    }
    return collection;
  }

  private async getExistingCollectionItem(collectionId: string, itemId: string): Promise<CollectionItem> {
    await this.getExistingCollection(collectionId);
    const item = await this.repo.getCollectionItemById(normalizeRequiredString(itemId, 'itemId'));
    if (!item || item.collection_id !== collectionId) {
      throw new NotFoundError('Collection item not found');
    }
    return item;
  }

  private async getExistingComposition(compositionId: string): Promise<Composition> {
    const composition = await this.repo.getCompositionById(normalizeRequiredString(compositionId, 'compositionId'));
    if (!composition) {
      throw new NotFoundError('Composition not found');
    }
    return composition;
  }

  private async getExistingCompositionItem(compositionId: string, itemId: string): Promise<CompositionItem> {
    await this.getExistingComposition(compositionId);
    const item = await this.repo.getCompositionItemById(normalizeRequiredString(itemId, 'itemId'));
    if (!item || item.composition_id !== compositionId) {
      throw new NotFoundError('Composition item not found');
    }
    return item;
  }

  private async getExistingVariant(variantId: string) {
    const variant = await this.repo.getVariantById(variantId);
    if (!variant) {
      throw new NotFoundError('Subject not found');
    }
    return variant;
  }

  private async broadcastStylePresetPreviewsByIds(presetIds: string[]): Promise<void> {
    for (const presetId of presetIds) {
      const preset = await this.repo.getStylePresetPreview(presetId);
      if (preset) {
        this.broadcast({ type: 'style_preset:updated', preset });
      }
    }
  }
}

function normalizeRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} is required`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ValidationError(`${field} is required`);
  }
  return trimmed;
}

function normalizeOptionalString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeNullableStringOrJson(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return JSON.stringify(value);
  throw new ValidationError(`${field} must be a string, object, or null`);
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('metadata must be an object');
  }
  return value as Record<string, unknown>;
}

function normalizeInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value)) {
    throw new ValidationError(`${field} must be an integer`);
  }
  return value as number;
}

function normalizeOptionalInteger(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  return normalizeInteger(value, field);
}

function normalizeOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') {
    throw new ValidationError('boolean option must be a boolean');
  }
  return value;
}

function normalizeBackfillInput(value: unknown): ParentHierarchyBackfillInput {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('backfill options must be an object');
  }
  return value as ParentHierarchyBackfillInput;
}

function normalizeIdArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new ValidationError(`${field} must be an array`);
  }
  const ids = value.map((item) => normalizeRequiredString(item, field));
  if (new Set(ids).size !== ids.length) {
    throw new ValidationError(`${field} must not contain duplicates`);
  }
  return ids;
}

function normalizeSubjectType(value: unknown): SpaceSubjectType {
  if (value === 'asset' || value === 'variant') {
    return value;
  }
  throw new ValidationError('subjectType must be asset or variant');
}

function normalizeCollectionKind(value: unknown): CollectionKind {
  if (typeof value === 'string' && COLLECTION_KINDS.has(value as CollectionKind)) {
    return value as CollectionKind;
  }
  throw new ValidationError('Invalid collection kind');
}

function normalizeCollectionColor(value: unknown): string | null {
  const color = normalizeOptionalString(value);
  if (!color) return null;
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    throw new ValidationError('color must be a hex color');
  }
  return color.toLowerCase();
}

function normalizeRelationType(value: unknown): SpaceRelationType {
  if (RELATION_TYPES.has(value as SpaceRelationType)) {
    return value as SpaceRelationType;
  }
  throw new ValidationError('Invalid relation type');
}

function normalizeCompositionRole(value: unknown): CompositionItemRole {
  if (COMPOSITION_ROLES.has(value as CompositionItemRole)) {
    return value as CompositionItemRole;
  }
  throw new ValidationError('Invalid role');
}

function normalizeCompositionStatus(value: unknown): CompositionStatus {
  if (COMPOSITION_STATUSES.has(value as CompositionStatus)) {
    return value as CompositionStatus;
  }
  throw new ValidationError('status must be draft or final');
}
