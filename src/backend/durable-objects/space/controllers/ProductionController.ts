import type {
  Production,
  ProductionCue,
  ProductionCueType,
  ProductionPlacement,
  ProductionPlacementTargetKind,
  ProductionRecord,
  ProductionShot,
} from '../types';
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

export interface UpsertProductionInput {
  id?: string;
  name: string;
  description?: string;
  metadata?: Record<string, unknown>;
  createdBy: string;
}

export interface UpsertProductionShotInput {
  id?: string;
  shotId?: string;
  label: string;
  timelineStartMs: number;
  durationMs?: number;
  metadata?: Record<string, unknown>;
  createdBy: string;
}

export interface UpsertProductionCueInput {
  id?: string;
  cueType?: ProductionCueType;
  label: string;
  timelineStartMs: number;
  durationMs?: number;
  metadata?: Record<string, unknown>;
  createdBy: string;
}

export interface UpsertProductionPlacementInput {
  id?: string;
  targetKind: ProductionPlacementTargetKind;
  targetId: string;
  variantId: string;
  role?: string;
  sourceRefs?: string[];
  sourceVariantIds?: string[];
  metadata?: Record<string, unknown>;
  createdBy: string;
}

export interface ProductionDetail {
  production: Production;
  shots: ProductionShot[];
  cues: ProductionCue[];
  placements: ProductionPlacement[];
}

export class ProductionController extends BaseController {
  constructor(ctx: ControllerContext) {
    super(ctx);
  }

  async httpListProductions(): Promise<Production[]> {
    return this.repo.getAllProductions();
  }

  async httpGetProduction(productionId: string): Promise<ProductionDetail> {
    const production = await this.getExistingProduction(productionId);
    const [shots, cues, placements] = await Promise.all([
      this.repo.getProductionShots(production.id),
      this.repo.getProductionCues(production.id),
      this.repo.getProductionPlacements(production.id),
    ]);
    return { production, shots, cues, placements };
  }

  async httpUpsertProduction(data: UpsertProductionInput): Promise<Production> {
    const name = normalizeRequiredString(data.name, 'name');
    const createdBy = normalizeRequiredString(data.createdBy, 'createdBy');
    return this.repo.upsertProduction({
      id: normalizeOptionalString(data.id) ?? crypto.randomUUID(),
      name,
      description: normalizeOptionalString(data.description),
      metadata: data.metadata ?? {},
      createdBy,
    });
  }

  async httpDeleteProduction(productionId: string): Promise<void> {
    const deleted = await this.repo.deleteProduction(normalizeRequiredString(productionId, 'productionId'));
    if (!deleted) {
      throw new NotFoundError('Production not found');
    }
  }

  async httpUpsertShot(productionId: string, data: UpsertProductionShotInput): Promise<ProductionShot> {
    const production = await this.getExistingProduction(productionId);
    const label = normalizeRequiredString(data.label, 'label');
    const createdBy = normalizeRequiredString(data.createdBy, 'createdBy');
    const timelineStartMs = normalizeNonNegativeInteger(data.timelineStartMs, 'timelineStartMs');
    const durationMs = data.durationMs === undefined
      ? null
      : normalizeNonNegativeInteger(data.durationMs, 'durationMs');

    return this.repo.upsertProductionShot({
      id: normalizeOptionalString(data.id) ?? crypto.randomUUID(),
      productionId: production.id,
      shotId: normalizeOptionalString(data.shotId),
      label,
      timelineStartMs,
      durationMs,
      metadata: data.metadata ?? {},
      createdBy,
    });
  }

  async httpDeleteShot(productionId: string, shotId: string): Promise<void> {
    const production = await this.getExistingProduction(productionId);
    const normalizedShotId = normalizeRequiredString(shotId, 'shotId');
    const shot = await this.repo.getProductionShotById(normalizedShotId);
    if (!shot || shot.production_id !== production.id) {
      throw new NotFoundError('Production shot not found');
    }
    const deleted = await this.repo.deleteProductionShot(normalizedShotId);
    if (!deleted) {
      throw new NotFoundError('Production shot not found');
    }
  }

  async httpUpsertCue(productionId: string, data: UpsertProductionCueInput): Promise<ProductionCue> {
    const production = await this.getExistingProduction(productionId);
    const label = normalizeRequiredString(data.label, 'label');
    const createdBy = normalizeRequiredString(data.createdBy, 'createdBy');
    const timelineStartMs = normalizeNonNegativeInteger(data.timelineStartMs, 'timelineStartMs');
    const durationMs = data.durationMs === undefined
      ? null
      : normalizeNonNegativeInteger(data.durationMs, 'durationMs');

    return this.repo.upsertProductionCue({
      id: normalizeOptionalString(data.id) ?? crypto.randomUUID(),
      productionId: production.id,
      cueType: normalizeCueType(data.cueType),
      label,
      timelineStartMs,
      durationMs,
      metadata: data.metadata ?? {},
      createdBy,
    });
  }

  async httpDeleteCue(productionId: string, cueId: string): Promise<void> {
    const production = await this.getExistingProduction(productionId);
    const normalizedCueId = normalizeRequiredString(cueId, 'cueId');
    const cue = await this.repo.getProductionCueById(normalizedCueId);
    if (!cue || cue.production_id !== production.id) {
      throw new NotFoundError('Production cue not found');
    }
    const deleted = await this.repo.deleteProductionCue(normalizedCueId);
    if (!deleted) {
      throw new NotFoundError('Production cue not found');
    }
  }

  async httpUpsertPlacement(
    productionId: string,
    data: UpsertProductionPlacementInput
  ): Promise<ProductionPlacement> {
    const production = await this.getExistingProduction(productionId);
    const targetKind = normalizeTargetKind(data.targetKind);
    const targetId = normalizeRequiredString(data.targetId, 'targetId');
    const variant = await this.getExistingVariant(data.variantId);
    const createdBy = normalizeRequiredString(data.createdBy, 'createdBy');
    const placementId = normalizeOptionalString(data.id) ?? crypto.randomUUID();

    await this.assertTargetBelongsToProduction(production.id, targetKind, targetId);
    await this.assertPlacementIdBelongsToProduction(production.id, placementId);
    const sourceVariantIds = await this.normalizeAndValidateSourceVariantIds(data.sourceVariantIds);

    return this.repo.upsertProductionPlacement({
      id: placementId,
      productionId: production.id,
      targetKind,
      targetId,
      variantId: variant.id,
      assetId: variant.asset_id,
      mediaKind: variant.media_kind,
      role: normalizeOptionalString(data.role),
      sourceRefs: normalizeStringArray(data.sourceRefs, 'sourceRefs'),
      sourceVariantIds,
      metadata: data.metadata ?? {},
      createdBy,
    });
  }

  async httpDeletePlacement(productionId: string, placementId: string): Promise<void> {
    const production = await this.getExistingProduction(productionId);
    const normalizedPlacementId = normalizeRequiredString(placementId, 'placementId');
    const placement = await this.repo.getProductionPlacementById(normalizedPlacementId);
    if (!placement || placement.production_id !== production.id) {
      throw new NotFoundError('Production placement not found');
    }
    const deleted = await this.repo.deleteProductionPlacement(normalizedPlacementId);
    if (!deleted) {
      throw new NotFoundError('Production placement not found');
    }
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

    const variant = await this.getExistingVariant(variantId);
    const sourceVariantIds = await this.normalizeAndValidateSourceVariantIds(data.sourceVariantIds);
    const recordId = normalizeOptionalString(data.id) ?? crypto.randomUUID();

    const production = await this.repo.upsertProduction({
      id: productionId,
      name: productionId,
      metadata: {},
      createdBy,
    });
    const shot = await this.repo.upsertProductionShot({
      id: normalizeOptionalString(data.shotId) ?? `${recordId}:shot`,
      productionId: production.id,
      shotId: normalizeOptionalString(data.shotId),
      label: sceneLabel,
      timelineStartMs,
      durationMs,
      metadata: {},
      createdBy,
    });
    await this.repo.upsertProductionPlacement({
      id: recordId,
      productionId: production.id,
      targetKind: 'shot',
      targetId: shot.id,
      variantId: variant.id,
      assetId: variant.asset_id,
      mediaKind: variant.media_kind,
      role: 'primary',
      sourceRefs: normalizeStringArray(data.sourceRefs, 'sourceRefs'),
      sourceVariantIds,
      metadata: data.metadata ?? {},
      createdBy,
    });

    return this.repo.upsertProductionRecord({
      id: recordId,
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

  private async getExistingProduction(productionId: string): Promise<Production> {
    const normalizedProductionId = normalizeRequiredString(productionId, 'productionId');
    const production = await this.repo.getProductionById(normalizedProductionId);
    if (!production) {
      throw new NotFoundError('Production not found');
    }
    return production;
  }

  private async getExistingVariant(variantId: string) {
    const normalizedVariantId = normalizeRequiredString(variantId, 'variantId');
    const variant = await this.repo.getVariantById(normalizedVariantId);
    if (!variant) {
      throw new NotFoundError('Variant not found');
    }
    return variant;
  }

  private async assertTargetBelongsToProduction(
    productionId: string,
    targetKind: ProductionPlacementTargetKind,
    targetId: string
  ): Promise<void> {
    if (targetKind === 'shot') {
      const shot = await this.repo.getProductionShotById(targetId);
      if (!shot || shot.production_id !== productionId) {
        throw new ValidationError('targetId must reference a shot in this production');
      }
      return;
    }

    const cue = await this.repo.getProductionCueById(targetId);
    if (!cue || cue.production_id !== productionId) {
      throw new ValidationError('targetId must reference a cue in this production');
    }
  }

  private async assertPlacementIdBelongsToProduction(productionId: string, placementId: string): Promise<void> {
    const existing = await this.repo.getProductionPlacementById(placementId);
    if (existing && existing.production_id !== productionId) {
      throw new NotFoundError('Production placement not found');
    }
  }

  private async normalizeAndValidateSourceVariantIds(value: unknown): Promise<string[]> {
    const sourceVariantIds = normalizeStringArray(value, 'sourceVariantIds');
    if (sourceVariantIds.length === 0) {
      return sourceVariantIds;
    }

    const sourceVariants = await this.repo.getVariantsByIds(sourceVariantIds);
    if (sourceVariants.length !== sourceVariantIds.length) {
      throw new ValidationError('sourceVariantIds must reference variants in this space');
    }
    return sourceVariantIds;
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

function normalizeCueType(value: unknown): ProductionCueType {
  if (value === undefined || value === null) return 'custom';
  if (value === 'music' || value === 'sfx' || value === 'dialogue' || value === 'ambience' || value === 'custom') {
    return value;
  }
  throw new ValidationError('cueType must be music, sfx, dialogue, ambience, or custom');
}

function normalizeTargetKind(value: unknown): ProductionPlacementTargetKind {
  if (value === 'shot' || value === 'cue') {
    return value;
  }
  throw new ValidationError('targetKind must be shot or cue');
}
