import type {
  StylePresetPreview,
  StyleReferenceCollectionPreview,
  WebSocketMeta,
} from '../types';
import {
  BaseController,
  ConflictError,
  NotFoundError,
  ValidationError,
  type ControllerContext,
} from './types';

interface StylePresetInput {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  stylePrompt?: unknown;
  collectionId?: unknown;
  enabled?: unknown;
  isDefault?: unknown;
  createdBy?: unknown;
}

interface StylePresetUpdateInput {
  name?: unknown;
  description?: unknown;
  stylePrompt?: unknown;
  collectionId?: unknown;
  enabled?: unknown;
  isDefault?: unknown;
}

export class StylePresetController extends BaseController {
  constructor(ctx: ControllerContext) {
    super(ctx);
  }

  async httpListStyleReferenceCollections(): Promise<StyleReferenceCollectionPreview[]> {
    return this.repo.listStyleReferenceCollections();
  }

  async httpListStylePresets(): Promise<StylePresetPreview[]> {
    return this.repo.listStylePresetPreviews();
  }

  async httpCreateStylePreset(data: StylePresetInput): Promise<StylePresetPreview> {
    const preset = await this.createStylePreset(data);
    this.broadcast({ type: 'style_preset:created', preset });
    return preset;
  }

  async httpUpdateStylePreset(presetId: string, data: StylePresetUpdateInput): Promise<StylePresetPreview> {
    const preset = await this.updateStylePreset(presetId, data);
    this.broadcast({ type: 'style_preset:updated', preset });
    return preset;
  }

  async httpDeleteStylePreset(presetId: string): Promise<void> {
    const normalizedPresetId = normalizeRequiredString(presetId, 'presetId');
    const deleted = await this.repo.deleteStylePreset(normalizedPresetId);
    if (!deleted) {
      throw new NotFoundError('Style preset not found');
    }
    this.broadcast({ type: 'style_preset:deleted', presetId: normalizedPresetId });
  }

  async handleCreateStylePreset(_ws: WebSocket, meta: WebSocketMeta, data: StylePresetInput): Promise<void> {
    this.requireEditor(meta);
    const preset = await this.createStylePreset({ ...data, createdBy: meta.userId });
    this.broadcast({ type: 'style_preset:created', preset });
  }

  async handleUpdateStylePreset(
    _ws: WebSocket,
    meta: WebSocketMeta,
    presetId: string,
    data: StylePresetUpdateInput
  ): Promise<void> {
    this.requireEditor(meta);
    const preset = await this.updateStylePreset(presetId, data);
    this.broadcast({ type: 'style_preset:updated', preset });
  }

  async handleDeleteStylePreset(_ws: WebSocket, meta: WebSocketMeta, presetId: string): Promise<void> {
    this.requireEditor(meta);
    await this.httpDeleteStylePreset(presetId);
  }

  private async createStylePreset(data: StylePresetInput): Promise<StylePresetPreview> {
    const name = normalizeRequiredString(data.name, 'name');
    const createdBy = normalizeRequiredString(data.createdBy, 'createdBy');
    const enabled = data.enabled === undefined ? true : normalizeBoolean(data.enabled, 'enabled');
    const isDefault = data.isDefault === undefined ? false : normalizeBoolean(data.isDefault, 'isDefault');
    if (isDefault && !enabled) {
      throw new ConflictError('Default style preset must be enabled');
    }

    const collectionId = await this.normalizeStyleCollectionId(data.collectionId);
    const preset = await this.repo.createStylePreset({
      id: normalizeOptionalString(data.id) ?? crypto.randomUUID(),
      name,
      description: normalizeNullableString(data.description, 'description'),
      stylePrompt: data.stylePrompt === undefined ? '' : normalizeString(data.stylePrompt, 'stylePrompt'),
      collectionId,
      enabled,
      isDefault,
      createdBy,
    });
    const preview = await this.repo.getStylePresetPreview(preset.id);
    if (!preview) {
      throw new NotFoundError('Style preset not found');
    }
    return preview;
  }

  private async updateStylePreset(presetId: string, data: StylePresetUpdateInput): Promise<StylePresetPreview> {
    const existing = await this.repo.getStylePresetById(normalizeRequiredString(presetId, 'presetId'));
    if (!existing) {
      throw new NotFoundError('Style preset not found');
    }

    const enabled = data.enabled === undefined ? undefined : normalizeBoolean(data.enabled, 'enabled');
    const isDefault = data.isDefault === undefined ? undefined : normalizeBoolean(data.isDefault, 'isDefault');
    const effectiveEnabled = enabled ?? (existing.enabled === 1);
    const effectiveDefault = isDefault ?? (existing.is_default === 1);
    if (effectiveDefault && !effectiveEnabled) {
      throw new ConflictError('Default style preset must be enabled');
    }

    const preset = await this.repo.updateStylePreset(existing.id, {
      name: data.name === undefined ? undefined : normalizeRequiredString(data.name, 'name'),
      description: data.description === undefined
        ? undefined
        : normalizeNullableString(data.description, 'description'),
      stylePrompt: data.stylePrompt === undefined ? undefined : normalizeString(data.stylePrompt, 'stylePrompt'),
      collectionId: data.collectionId === undefined
        ? undefined
        : await this.normalizeStyleCollectionId(data.collectionId),
      enabled,
      isDefault,
    });
    if (!preset) {
      throw new NotFoundError('Style preset not found');
    }
    const preview = await this.repo.getStylePresetPreview(preset.id);
    if (!preview) {
      throw new NotFoundError('Style preset not found');
    }
    return preview;
  }

  private async normalizeStyleCollectionId(value: unknown): Promise<string | null> {
    const collectionId = normalizeOptionalString(value);
    if (!collectionId) return null;

    const collection = await this.repo.getCollectionById(collectionId);
    if (!collection) {
      throw new NotFoundError('Style reference collection not found');
    }

    const items = await this.repo.listCollectionItems(collectionId);
    if (items.some((item) => item.role !== 'style_ref')) {
      throw new ValidationError('Invalid style reference collection');
    }
    return collection.id;
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

function normalizeString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} must be a string`);
  }
  return value.trim();
}

function normalizeOptionalString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeNullableString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} must be a string or null`);
  }
  return value.trim() || null;
}

function normalizeBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new ValidationError(`${field} must be a boolean`);
  }
  return value;
}
