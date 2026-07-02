import type {
  CollectionItem,
  CollectionKind,
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
