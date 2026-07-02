import type {
  CollectionItem,
  CollectionKind,
  SpaceCollection,
  SpaceSubjectType,
  WebSocketMeta,
} from '../types';
import { BaseController, type ControllerContext, NotFoundError, ValidationError } from './types';

const COLLECTION_KINDS = new Set<CollectionKind>([
  'cast',
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

interface ParentHierarchyBackfillInput {
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
    return collection;
  }

  async httpDeleteCollection(collectionId: string): Promise<void> {
    await this.deleteCollection(collectionId);
    this.broadcast({ type: 'collection:deleted', collectionId });
  }

  async httpListCollectionItems(collectionId: string): Promise<CollectionItem[]> {
    await this.getExistingCollection(collectionId);
    return this.repo.listCollectionItems(collectionId);
  }

  async httpCreateCollectionItem(collectionId: string, data: CollectionItemInput): Promise<CollectionItem> {
    const item = await this.createCollectionItem(collectionId, data);
    this.broadcast({ type: 'collection_item:created', item });
    return item;
  }

  async httpUpdateCollectionItem(collectionId: string, itemId: string, data: CollectionItemUpdateInput): Promise<CollectionItem> {
    const item = await this.updateCollectionItem(collectionId, itemId, data);
    this.broadcast({ type: 'collection_item:updated', item });
    return item;
  }

  async httpReorderCollectionItems(collectionId: string, itemIds: unknown): Promise<CollectionItem[]> {
    const items = await this.reorderCollectionItems(collectionId, itemIds);
    this.broadcast({ type: 'collection_items:reordered', collectionId, items });
    return items;
  }

  async httpDeleteCollectionItem(collectionId: string, itemId: string): Promise<void> {
    await this.deleteCollectionItem(collectionId, itemId);
    this.broadcast({ type: 'collection_item:deleted', collectionId, itemId });
  }

  async httpBackfillParentHierarchy(input: unknown = {}) {
    const data = normalizeBackfillInput(input);
    const [beforeCollections, beforeItems] = await Promise.all([
      this.repo.listCollections(),
      this.repo.listAllCollectionItems(),
    ]);
    const result = await this.repo.backfillParentHierarchyToOrganization({
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
    const [afterCollections, afterItems] = await Promise.all([
      this.repo.listCollections(),
      this.repo.listAllCollectionItems(),
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
  }

  async handleDeleteCollection(_ws: WebSocket, meta: WebSocketMeta, collectionId: string): Promise<void> {
    this.requireEditor(meta);
    await this.deleteCollection(collectionId);
    this.broadcast({ type: 'collection:deleted', collectionId });
  }

  async handleCreateCollectionItem(_ws: WebSocket, meta: WebSocketMeta, collectionId: string, data: CollectionItemInput): Promise<void> {
    this.requireEditor(meta);
    const item = await this.createCollectionItem(collectionId, { ...data, createdBy: meta.userId });
    this.broadcast({ type: 'collection_item:created', item });
  }

  async handleUpdateCollectionItem(_ws: WebSocket, meta: WebSocketMeta, collectionId: string, itemId: string, data: CollectionItemUpdateInput): Promise<void> {
    this.requireEditor(meta);
    const item = await this.updateCollectionItem(collectionId, itemId, data);
    this.broadcast({ type: 'collection_item:updated', item });
  }

  async handleReorderCollectionItems(_ws: WebSocket, meta: WebSocketMeta, collectionId: string, itemIds: unknown): Promise<void> {
    this.requireEditor(meta);
    const items = await this.reorderCollectionItems(collectionId, itemIds);
    this.broadcast({ type: 'collection_items:reordered', collectionId, items });
  }

  async handleDeleteCollectionItem(_ws: WebSocket, meta: WebSocketMeta, collectionId: string, itemId: string): Promise<void> {
    this.requireEditor(meta);
    await this.deleteCollectionItem(collectionId, itemId);
    this.broadcast({ type: 'collection_item:deleted', collectionId, itemId });
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
