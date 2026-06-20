/**
 * Reference Image Limit Utilities
 *
 * Ensures combined style + pipeline reference images fit within
 * Gemini's per-request limit (14 images).
 */

import type { SpaceRepository } from '../repository/SpaceRepository';

type StyleResolverRepository = SpaceRepository & {
  getDefaultStylePreset?: SpaceRepository['getDefaultStylePreset'];
  resolveStylePresetReferences?: SpaceRepository['resolveStylePresetReferences'];
  getVariantImageKey?: SpaceRepository['getVariantImageKey'];
};

export interface ResolvedStyleReference {
  variantId?: string;
  imageKey: string;
}

export interface ResolvedStyleReferences {
  styleKeys: string[];
  styleDescription: string | null;
  stylePresetId?: string;
  styleId?: string;
  styleCollectionId?: string | null;
  stylePrompt?: string;
  styleReferenceVariantIds: string[];
  styleReferenceImageKeys: string[];
  references: ResolvedStyleReference[];
  styleOverride?: boolean;
}

/**
 * Cap pipeline refs to fit within Gemini's limit alongside style refs.
 * Always keeps the source image AND the front/first generated view (masterKey),
 * then fills remaining budget with most recent views.
 *
 * Pinning the front view ensures later steps in rotation/tile pipelines
 * always have the canonical reference, reducing inter-step drift.
 */
export function capRefs(
  styleKeys: string[],
  pipelineKeys: string[],
  sourceKey: string,
  maxTotal: number = 14,
  masterKey?: string
): string[] {
  const budget = maxTotal - styleKeys.length;
  if (budget <= 0) return [];
  if (pipelineKeys.length <= budget) return pipelineKeys;

  // Build pinned set: source + master (front view), deduplicating
  const pinned: string[] = [sourceKey];
  if (masterKey && masterKey !== sourceKey) {
    pinned.push(masterKey);
  }

  const pinnedSet = new Set(pinned);
  const remaining = pipelineKeys.filter(k => !pinnedSet.has(k));
  const fillCount = budget - pinned.length;

  return [...pinned, ...remaining.slice(-fillCount)];
}

/**
 * Get default style image keys for the current space.
 * Resolves the asset-backed default preset and returns its image keys + prompt.
 */
export async function getStyleImageKeys(
  repo: SpaceRepository,
  disableStyle?: boolean
): Promise<{ styleKeys: string[]; styleDescription: string | null }> {
  const resolved = await resolveStyleReferences(repo, { disableStyle });
  return { styleKeys: resolved.styleKeys, styleDescription: resolved.styleDescription };
}

export async function resolveStyleReferences(
  repo: SpaceRepository,
  input: {
    disableStyle?: boolean;
    stylePresetId?: string;
    styleVariantIds?: string[];
  } = {}
): Promise<ResolvedStyleReferences> {
  const resolverRepo = repo as StyleResolverRepository;
  if (input.disableStyle) {
    return emptyResolvedStyle({ styleOverride: true });
  }

  const explicitStyleVariantIds = uniqueStrings(input.styleVariantIds ?? []);
  let stylePresetId = input.stylePresetId;
  let styleCollectionId: string | null | undefined;
  let stylePrompt: string | undefined;
  const references: ResolvedStyleReference[] = [];

  if (!stylePresetId && explicitStyleVariantIds.length === 0) {
    const defaultPreset = await resolverRepo.getDefaultStylePreset?.();
    if (defaultPreset?.enabled) {
      stylePresetId = defaultPreset.id;
    }
  }

  if (stylePresetId) {
    if (!resolverRepo.resolveStylePresetReferences) {
      throw new Error(`Style preset ${stylePresetId} not found`);
    }
    const preset = await resolverRepo.resolveStylePresetReferences(stylePresetId);
    if (!preset) {
      throw new Error(`Style preset ${stylePresetId} not found`);
    }
    if (preset.preset.enabled) {
      styleCollectionId = preset.styleCollectionId;
      stylePrompt = preset.stylePrompt;
      for (const variantId of preset.styleReferenceVariantIds) {
        const imageKey = await resolveStyleVariantImageKey(resolverRepo, variantId, false);
        if (imageKey) {
          references.push({ variantId, imageKey });
        }
      }
    }
  }

  for (const variantId of explicitStyleVariantIds) {
    const imageKey = await resolveStyleVariantImageKey(resolverRepo, variantId, true);
    if (!imageKey) continue;
    references.push({ variantId, imageKey });
  }

  if (stylePresetId || explicitStyleVariantIds.length > 0) {
    return buildResolvedStyle({
      references,
      styleDescription: stylePrompt || null,
      stylePresetId,
      styleCollectionId,
      stylePrompt,
    });
  }

  return emptyResolvedStyle();
}

export function withStyleReferenceLimit(
  style: ResolvedStyleReferences,
  maxStyleImages: number
): ResolvedStyleReferences {
  if (maxStyleImages < 0) {
    return { ...style, ...emptyStyleReferences() };
  }
  if (style.references.length <= maxStyleImages) {
    return style;
  }
  return buildResolvedStyle({
    ...style,
    references: style.references.slice(0, maxStyleImages),
  });
}

export function withoutStyleReferenceImages(style: ResolvedStyleReferences): ResolvedStyleReferences {
  return buildResolvedStyle({
    ...style,
    references: [],
  });
}

function emptyResolvedStyle(extra: Partial<ResolvedStyleReferences> = {}): ResolvedStyleReferences {
  return {
    styleKeys: [],
    styleDescription: null,
    styleReferenceVariantIds: [],
    styleReferenceImageKeys: [],
    references: [],
    ...extra,
  };
}

function emptyStyleReferences(): Pick<ResolvedStyleReferences, 'styleKeys' | 'styleReferenceVariantIds' | 'styleReferenceImageKeys' | 'references'> {
  return {
    styleKeys: [],
    styleReferenceVariantIds: [],
    styleReferenceImageKeys: [],
    references: [],
  };
}

function buildResolvedStyle(input: {
  references: ResolvedStyleReference[];
  styleDescription: string | null;
  stylePresetId?: string;
  styleId?: string;
  styleCollectionId?: string | null;
  stylePrompt?: string;
  styleOverride?: boolean;
}): ResolvedStyleReferences {
  const references = dedupeReferences(input.references);
  return {
    styleKeys: references.map((ref) => ref.imageKey),
    styleDescription: input.styleDescription,
    stylePresetId: input.stylePresetId,
    styleId: input.styleId,
    styleCollectionId: input.styleCollectionId,
    stylePrompt: input.stylePrompt,
    styleReferenceVariantIds: references.flatMap((ref) => ref.variantId ? [ref.variantId] : []),
    styleReferenceImageKeys: references.map((ref) => ref.imageKey),
    references,
    styleOverride: input.styleOverride,
  };
}

function dedupeReferences(references: ResolvedStyleReference[]): ResolvedStyleReference[] {
  const seenVariantIds = new Set<string>();
  const seenImageKeys = new Set<string>();
  const deduped: ResolvedStyleReference[] = [];
  for (const ref of references) {
    if (ref.variantId) {
      if (seenVariantIds.has(ref.variantId)) continue;
      seenVariantIds.add(ref.variantId);
    }
    if (seenImageKeys.has(ref.imageKey)) continue;
    seenImageKeys.add(ref.imageKey);
    deduped.push(ref);
  }
  return deduped;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.length > 0))];
}

async function resolveStyleVariantImageKey(
  repo: StyleResolverRepository,
  variantId: string,
  required: boolean
): Promise<string | null> {
  const variant = await repo.getVariantById(variantId);
  const imageKey = variant?.image_key ?? await repo.getVariantImageKey?.(variantId);
  if (imageKey) return imageKey;
  if (required) {
    throw new Error(`Style variant ${variantId} is not a completed image variant`);
  }
  return null;
}
