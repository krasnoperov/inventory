import type { ProductionRecord } from '../types';
import { BaseController, type ControllerContext, NotFoundError, ValidationError } from './types';

export interface PlaceProductionRecordInput {
  id?: string;
  productionId: string;
  variantId: string;
  shotId?: string;
  sceneLabel: string;
  timelineStartMs: number;
  durationMs?: number;
  motionPrompt?: string;
  sourceRefs?: string[];
  sourceVariantIds?: string[];
  metadata?: Record<string, unknown>;
  createdBy: string;
}

export class ProductionController extends BaseController {
  constructor(ctx: ControllerContext) {
    super(ctx);
  }

  async httpListRecords(productionId: string): Promise<ProductionRecord[]> {
    const normalizedProductionId = normalizeRequiredString(productionId, 'productionId');
    return this.repo.getProductionRecordsByProductionId(normalizedProductionId);
  }

  async httpPlaceRecord(data: PlaceProductionRecordInput): Promise<ProductionRecord> {
    const productionId = normalizeRequiredString(data.productionId, 'productionId');
    const variantId = normalizeRequiredString(data.variantId, 'variantId');
    const sceneLabel = normalizeRequiredString(data.sceneLabel, 'sceneLabel');
    const createdBy = normalizeRequiredString(data.createdBy, 'createdBy');
    const timelineStartMs = normalizeNonNegativeInteger(data.timelineStartMs, 'timelineStartMs');
    const durationMs = data.durationMs === undefined
      ? null
      : normalizeNonNegativeInteger(data.durationMs, 'durationMs');

    const variant = await this.repo.getVariantById(variantId);
    if (!variant) {
      throw new NotFoundError('Variant not found');
    }

    const sourceVariantIds = normalizeStringArray(data.sourceVariantIds, 'sourceVariantIds');
    if (sourceVariantIds.length > 0) {
      const sourceVariants = await this.repo.getVariantsByIds(sourceVariantIds);
      if (sourceVariants.length !== new Set(sourceVariantIds).size) {
        throw new ValidationError('sourceVariantIds must reference variants in this space');
      }
    }

    return this.repo.upsertProductionRecord({
      id: normalizeOptionalString(data.id) ?? crypto.randomUUID(),
      productionId,
      variantId,
      assetId: variant.asset_id,
      mediaKind: variant.media_kind,
      shotId: normalizeOptionalString(data.shotId),
      sceneLabel,
      timelineStartMs,
      durationMs,
      motionPrompt: normalizeOptionalString(data.motionPrompt),
      sourceRefs: normalizeStringArray(data.sourceRefs, 'sourceRefs'),
      sourceVariantIds,
      metadata: data.metadata ?? {},
      createdBy,
    });
  }

  async httpDeleteRecord(recordId: string): Promise<void> {
    const normalizedRecordId = normalizeRequiredString(recordId, 'recordId');
    const deleted = await this.repo.deleteProductionRecord(normalizedRecordId);
    if (!deleted) {
      throw new NotFoundError('Production record not found');
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

function normalizeNonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new ValidationError(`${field} must be a non-negative integer`);
  }
  return value as number;
}

function normalizeStringArray(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new ValidationError(`${field} must be an array`);
  }

  const normalized: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      throw new ValidationError(`${field} must contain only strings`);
    }
    const trimmed = item.trim();
    if (trimmed) {
      normalized.push(trimmed);
    }
  }
  return Array.from(new Set(normalized));
}
