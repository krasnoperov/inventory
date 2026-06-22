import type {
  Asset,
  CompositionItem,
  CompositionItemRole,
  SpaceRelationContext,
  SpaceRelationType,
  SpaceSubject,
  Variant,
} from './hooks/useSpaceWebSocket';

export type CompositionShortcut =
  | { kind: 'none' }
  | { kind: 'output'; compositionId: string }
  | { kind: 'slot'; compositionId: string; role: CompositionItemRole; itemId?: string };

export type RelationShortcut =
  | { kind: 'none' }
  | { kind: 'relation'; relationType: SpaceRelationType; object: SpaceSubject };

export interface RelationShortcutOption {
  key: string;
  label: string;
  shortcut: RelationShortcut;
}

const SINGLE_SLOT_ROLES = new Set<CompositionItemRole>(['background', 'map']);
const SLOT_OPTIONS: Array<{ role: CompositionItemRole; noun: string; phrase: string }> = [
  { role: 'background', noun: 'background', phrase: 'Use as background' },
  { role: 'character', noun: 'character', phrase: 'Add as character' },
  { role: 'prop', noun: 'prop', phrase: 'Add as prop' },
  { role: 'style_ref', noun: 'style reference', phrase: 'Use as style reference' },
  { role: 'overlay', noun: 'overlay', phrase: 'Add as overlay' },
  { role: 'map', noun: 'map', phrase: 'Use as map' },
  { role: 'thumbnail', noun: 'thumbnail', phrase: 'Use as thumbnail' },
];

export const COMMON_RELATION_SHORTCUT_TYPES: Array<{ type: SpaceRelationType; phrase: string }> = [
  { type: 'thumbnail_for', phrase: 'Mark as thumbnail for' },
  { type: 'map_for', phrase: 'Mark as map for' },
  { type: 'background_for', phrase: 'Use as background in' },
  { type: 'style_reference_for', phrase: 'Use as style reference for' },
];

export function relationShortcutKey(shortcut: RelationShortcut): string {
  if (shortcut.kind === 'none') return 'none';
  const target = shortcut.object.subjectType === 'asset'
    ? `asset:${shortcut.object.assetId ?? ''}`
    : `variant:${shortcut.object.variantId ?? ''}`;
  return `relation:${shortcut.relationType}:${target}`;
}

/** Role a finished variant can take when placed into a composition. */
export type CompositionPlacementRole = 'output' | CompositionItemRole;

export interface CompositionPlacementRoleOption {
  role: CompositionPlacementRole;
  label: string;
}

/**
 * Roles offered when placing a finished variant into a composition, in the
 * order shown in the post-generation placement menu. `output` is the
 * composition's main result; the rest mirror SLOT_OPTIONS so the menu stays in
 * sync with what compositions actually support.
 */
export const COMPOSITION_PLACEMENT_ROLES: CompositionPlacementRoleOption[] = [
  { role: 'output', label: 'Output' },
  ...SLOT_OPTIONS.map((config) => ({
    role: config.role as CompositionPlacementRole,
    label: config.noun.charAt(0).toUpperCase() + config.noun.slice(1),
  })),
];

/**
 * Resolve the CompositionShortcut for placing a variant into a composition as a
 * given role. Single-slot roles (background, map) replace the existing item
 * when one is present; everything else appends a new item. This is the
 * post-generation counterpart to the old pre-generation dropdown — the decision
 * is made over a finished variant, not predicted before it exists.
 */
export function resolveCompositionPlacementShortcut(
  compositionId: string,
  role: CompositionPlacementRole,
  compositionItems: CompositionItem[],
): CompositionShortcut {
  if (role === 'output') {
    return { kind: 'output', compositionId };
  }
  const existing = SINGLE_SLOT_ROLES.has(role)
    ? compositionItems.find((item) => item.composition_id === compositionId && item.role === role)
    : null;
  return existing
    ? { kind: 'slot', compositionId, role, itemId: existing.id }
    : { kind: 'slot', compositionId, role };
}

function getAssetLabel(asset: Asset): string {
  return asset.name.trim() || 'Untitled asset';
}

export function buildRelationShortcutOptions(assets: Asset[]): RelationShortcutOption[] {
  const options: RelationShortcutOption[] = [
    { key: 'none', label: 'No relation shortcut', shortcut: { kind: 'none' } },
  ];

  for (const asset of assets) {
    for (const config of COMMON_RELATION_SHORTCUT_TYPES) {
      const shortcut: RelationShortcut = {
        kind: 'relation',
        relationType: config.type,
        object: { subjectType: 'asset', assetId: asset.id },
      };
      options.push({
        key: relationShortcutKey(shortcut),
        label: `${config.phrase} ${getAssetLabel(asset)}`,
        shortcut,
      });
    }
  }

  return options;
}

export function buildImmediateRelationLabel(relationType: SpaceRelationType, targetLabel: string): string {
  const match = COMMON_RELATION_SHORTCUT_TYPES.find((entry) => entry.type === relationType);
  return `${match?.phrase ?? 'Relate to'} ${targetLabel}`;
}

export function getSubjectLabel(subject: SpaceSubject, assets: Asset[], variants: Variant[]): string {
  if (subject.subjectType === 'asset') {
    return assets.find((asset) => asset.id === subject.assetId)?.name ?? 'Missing asset';
  }
  const variant = variants.find((entry) => entry.id === subject.variantId);
  const asset = variant ? assets.find((entry) => entry.id === variant.asset_id) : null;
  return asset ? `${asset.name} variant ${variant!.id.slice(0, 8)}` : 'Missing variant';
}

export function applyCompositionShortcut(
  shortcut: CompositionShortcut | undefined,
  variant: Variant,
  compositionItems: CompositionItem[],
  actions: {
    updateComposition: (compositionId: string, changes: {
      outputAssetId?: string | null;
      outputVariantId?: string | null;
    }) => void;
    createCompositionItem: (compositionId: string, params: {
      role: CompositionItemRole;
      assetId?: string | null;
      variantId: string;
      sortIndex?: number;
    }) => void;
    updateCompositionItem: (compositionId: string, itemId: string, changes: {
      assetId?: string | null;
      variantId?: string;
    }) => void;
  },
): void {
  if (!shortcut || shortcut.kind === 'none') return;

  if (shortcut.kind === 'output') {
    actions.updateComposition(shortcut.compositionId, {
      outputAssetId: variant.asset_id,
      outputVariantId: variant.id,
    });
    return;
  }

  if (shortcut.itemId) {
    actions.updateCompositionItem(shortcut.compositionId, shortcut.itemId, {
      assetId: variant.asset_id,
      variantId: variant.id,
    });
    return;
  }

  const maxSort = compositionItems
    .filter((item) => item.composition_id === shortcut.compositionId)
    .reduce((max, item) => Math.max(max, item.sort_index), -1);
  actions.createCompositionItem(shortcut.compositionId, {
    role: shortcut.role,
    assetId: variant.asset_id,
    variantId: variant.id,
    sortIndex: maxSort + 1,
  });
}

export function applyRelationShortcut(
  shortcut: RelationShortcut | undefined,
  variant: Variant,
  createRelation: (params: {
    subject: SpaceSubject;
    object: SpaceSubject;
    relationType: SpaceRelationType;
    context?: SpaceRelationContext | string | null;
  }) => void,
): void {
  if (!shortcut || shortcut.kind === 'none') return;
  createRelation({
    subject: { subjectType: 'variant', variantId: variant.id },
    object: shortcut.object,
    relationType: shortcut.relationType,
    context: null,
  });
}
