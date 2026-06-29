import { type FormEvent, useMemo, useState } from 'react';
import {
  type Asset,
  type Lineage,
  type SpaceRelation,
  type SpaceRelationContext,
  type SpaceRelationType,
  type SpaceSubject,
  type Variant,
} from '../hooks/useSpaceWebSocket';
import { formatMediaKind } from '../mediaKind';
import { buildImmediateRelationLabel, COMMON_RELATION_SHORTCUT_TYPES } from '../productionShortcuts';
import { Button, IconButton, UiSelect, type SelectOption } from '../ui';
import { Thumbnail } from './Thumbnail';
import styles from './RelationsPanel.module.css';

type RelationTypeOption = SelectOption<SpaceRelationType> & { label: string };

export const RELATION_TYPES: RelationTypeOption[] = [
  { value: 'thumbnail_for', label: 'Thumbnail for' },
  { value: 'map_for', label: 'Map for' },
  { value: 'alternate_of', label: 'Alternate of' },
  { value: 'reference_for', label: 'Reference for' },
  { value: 'background_for', label: 'Background for' },
  { value: 'style_reference_for', label: 'Style reference for' },
  { value: 'appears_in', label: 'Appears in' },
  { value: 'prop_in', label: 'Prop in' },
  { value: 'part_of', label: 'Part of' },
  { value: 'custom', label: 'Custom' },
];

export function getRelationTypeLabel(type: SpaceRelationType): string {
  return RELATION_TYPES.find((option) => option.value === type)?.label ?? type.replaceAll('_', ' ');
}

export function parseRelationContext(context: string | null): SpaceRelationContext {
  if (!context) return {};
  try {
    const parsed = JSON.parse(context) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { notes: context };
    }
    const data = parsed as Record<string, unknown>;
    return {
      label: typeof data.label === 'string' ? data.label : undefined,
      context: typeof data.context === 'string' ? data.context : undefined,
      notes: typeof data.notes === 'string' ? data.notes : undefined,
    };
  } catch {
    return { notes: context };
  }
}

function buildRelationContext(label: string, context: string, notes: string): SpaceRelationContext | null {
  const next: SpaceRelationContext = {};
  if (label.trim()) next.label = label.trim();
  if (context.trim()) next.context = context.trim();
  if (notes.trim()) next.notes = notes.trim();
  return Object.keys(next).length > 0 ? next : null;
}

function getRelationShortcutLabel(type: SpaceRelationType): string {
  switch (type) {
    case 'thumbnail_for':
      return 'Thumbnail';
    case 'map_for':
      return 'Map';
    case 'background_for':
      return 'Background';
    case 'style_reference_for':
      return 'Style ref';
    default:
      return getRelationTypeLabel(type);
  }
}

function subjectKey(subject: SpaceSubject): string {
  return subject.subjectType === 'asset'
    ? `asset:${subject.assetId ?? ''}`
    : `variant:${subject.variantId ?? ''}`;
}

function relationSubject(relation: SpaceRelation): SpaceSubject {
  return relation.subject_type === 'asset'
    ? { subjectType: 'asset', assetId: relation.subject_asset_id ?? undefined }
    : { subjectType: 'variant', variantId: relation.subject_variant_id ?? undefined };
}

function relationObject(relation: SpaceRelation): SpaceSubject {
  return relation.object_type === 'asset'
    ? { subjectType: 'asset', assetId: relation.object_asset_id ?? undefined }
    : { subjectType: 'variant', variantId: relation.object_variant_id ?? undefined };
}

function relationMatchesAny(relation: SpaceRelation, subjects: SpaceSubject[], side: 'subject' | 'object'): boolean {
  const keys = new Set(subjects.map(subjectKey));
  return keys.has(subjectKey(side === 'subject' ? relationSubject(relation) : relationObject(relation)));
}

function getAssetVariant(asset: Asset, variants: Variant[]): Variant | null {
  return variants.find((variant) => variant.id === asset.active_variant_id)
    ?? variants.find((variant) => variant.asset_id === asset.id)
    ?? null;
}

function getSubjectLabel(subject: SpaceSubject, assets: Asset[], variants: Variant[]): string {
  if (subject.subjectType === 'asset') {
    return assets.find((asset) => asset.id === subject.assetId)?.name ?? 'Missing asset';
  }

  const variant = variants.find((entry) => entry.id === subject.variantId);
  const asset = variant ? assets.find((entry) => entry.id === variant.asset_id) : null;
  return asset ? `${asset.name} variant ${variant!.id.slice(0, 8)}` : 'Missing variant';
}

function subjectSearchText(subject: SpaceSubject, assets: Asset[], variants: Variant[]): string {
  if (subject.subjectType === 'asset') {
    const asset = assets.find((entry) => entry.id === subject.assetId);
    return [asset?.name, asset?.type, asset ? formatMediaKind(asset.media_kind) : undefined].filter(Boolean).join(' ');
  }

  const variant = variants.find((entry) => entry.id === subject.variantId);
  const asset = variant ? assets.find((entry) => entry.id === variant.asset_id) : null;
  return [asset?.name, variant?.id, variant ? formatMediaKind(variant.media_kind) : undefined, variant?.description].filter(Boolean).join(' ');
}

export interface RelationsPanelProps {
  assets: Asset[];
  variants: Variant[];
  relations: SpaceRelation[];
  subjects: SpaceSubject[];
  primarySubject: SpaceSubject;
  lineage?: Lineage[];
  onCreate: (subject: SpaceSubject) => void;
  onEdit: (relation: SpaceRelation) => void;
  onDelete: (relationId: string) => void;
}

export function RelationsPanel({
  assets,
  variants,
  relations,
  subjects,
  primarySubject,
  onCreate,
  onEdit,
  onDelete,
}: RelationsPanelProps) {
  const outgoing = useMemo(
    () => relations.filter((relation) => relationMatchesAny(relation, subjects, 'subject')),
    [relations, subjects],
  );
  const incoming = useMemo(
    () => relations.filter((relation) => relationMatchesAny(relation, subjects, 'object')),
    [relations, subjects],
  );

  return (
    <section className={styles.panel} aria-label="Manual relations">
      <div className={styles.header}>
        <h2 className={styles.title}>Relations</h2>
        <IconButton
          className={styles.headerAction}
          onClick={() => onCreate(primarySubject)}
          title="Create relation"
          aria-label="Create relation"
          variant="secondary"
          size="sm"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11 4.93" />
            <path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07L13 19.07" />
          </svg>
        </IconButton>
      </div>
      <RelationList
        title="Outgoing"
        emptyLabel="No outgoing relations"
        direction="outgoing"
        relations={outgoing}
        assets={assets}
        variants={variants}
        onEdit={onEdit}
        onDelete={onDelete}
      />
      <RelationList
        title="Incoming"
        emptyLabel="No incoming relations"
        direction="incoming"
        relations={incoming}
        assets={assets}
        variants={variants}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    </section>
  );
}

function RelationList({
  title,
  emptyLabel,
  direction,
  relations,
  assets,
  variants,
  onEdit,
  onDelete,
}: {
  title: string;
  emptyLabel: string;
  direction: 'outgoing' | 'incoming';
  relations: SpaceRelation[];
  assets: Asset[];
  variants: Variant[];
  onEdit: (relation: SpaceRelation) => void;
  onDelete: (relationId: string) => void;
}) {
  return (
    <div className={styles.group}>
      <div className={styles.groupTitle}>{title}</div>
      {relations.length === 0 ? (
        <div className={styles.empty}>{emptyLabel}</div>
      ) : (
        <div className={styles.rows}>
          {relations.map((relation) => {
            const source = relationSubject(relation);
            const target = relationObject(relation);
            const context = parseRelationContext(relation.context);
            return (
              <article key={`${direction}-${relation.id}`} className={styles.row}>
                <div className={styles.rowMain}>
                  <span className={styles.directionBadge}>{direction === 'outgoing' ? 'Out' : 'In'}</span>
                  <div className={styles.rowText}>
                    <div className={styles.rowTitle}>
                      {direction === 'outgoing'
                        ? `${getRelationTypeLabel(relation.relation_type)} -> ${getSubjectLabel(target, assets, variants)}`
                        : `${getSubjectLabel(source, assets, variants)} -> ${getRelationTypeLabel(relation.relation_type)}`}
                    </div>
                    {context.label && <div className={styles.rowLabel}>{context.label}</div>}
                    {context.context && <div className={styles.rowMeta}>{context.context}</div>}
                    {context.notes && <div className={styles.rowNotes}>{context.notes}</div>}
                  </div>
                </div>
                <div className={styles.rowActions}>
                  <Button className={styles.rowButton} onClick={() => onEdit(relation)} variant="ghost" size="sm">Edit</Button>
                  <Button className={styles.rowButton} onClick={() => onDelete(relation.id)} variant="ghost" size="sm">Clear</Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

export interface RelationEditorDialogProps {
  mode: 'create' | 'edit';
  assets: Asset[];
  variants: Variant[];
  sourceSubject: SpaceSubject;
  relation?: SpaceRelation;
  onCancel: () => void;
  onCreate: (params: {
    subject: SpaceSubject;
    object: SpaceSubject;
    relationType: SpaceRelationType;
    context: SpaceRelationContext | null;
  }) => void;
  onUpdate?: (relationId: string, changes: {
    relationType: SpaceRelationType;
    context: SpaceRelationContext | null;
  }) => void;
}

export function RelationEditorDialog({
  mode,
  assets,
  variants,
  sourceSubject,
  relation,
  onCancel,
  onCreate,
  onUpdate,
}: RelationEditorDialogProps) {
  const existingContext = parseRelationContext(relation?.context ?? null);
  const [relationType, setRelationType] = useState<SpaceRelationType>(relation?.relation_type ?? 'reference_for');
  const [targetSubject, setTargetSubject] = useState<SpaceSubject | null>(relation ? relationObject(relation) : null);
  const [query, setQuery] = useState('');
  const [label, setLabel] = useState(existingContext.label ?? '');
  const [context, setContext] = useState(existingContext.context ?? '');
  const [notes, setNotes] = useState(existingContext.notes ?? '');

  const sourceLabel = getSubjectLabel(sourceSubject, assets, variants);
  const canSubmit = mode === 'edit' || targetSubject !== null;
  const normalizedQuery = query.trim().toLowerCase();
  const options = useMemo(() => {
    const assetOptions = assets.map((asset) => ({
      key: `asset:${asset.id}`,
      subject: { subjectType: 'asset', assetId: asset.id } satisfies SpaceSubject,
      title: asset.name,
      subtitle: `${asset.type} / ${formatMediaKind(asset.media_kind)}`,
      variant: getAssetVariant(asset, variants),
    }));
    const variantOptions = variants.map((variant) => {
      const asset = assets.find((entry) => entry.id === variant.asset_id);
      return {
        key: `variant:${variant.id}`,
        subject: { subjectType: 'variant', variantId: variant.id } satisfies SpaceSubject,
        title: asset ? `${asset.name} variant` : 'Variant',
        subtitle: `${variant.id.slice(0, 8)} / ${formatMediaKind(variant.media_kind)}`,
        variant,
      };
    });
    return [...assetOptions, ...variantOptions]
      .filter((option) => subjectKey(option.subject) !== subjectKey(sourceSubject))
      .filter((option) => !normalizedQuery || subjectSearchText(option.subject, assets, variants).toLowerCase().includes(normalizedQuery));
  }, [assets, normalizedQuery, sourceSubject, variants]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const contextValue = buildRelationContext(label, context, notes);
    if (mode === 'edit' && relation) {
      onUpdate?.(relation.id, { relationType, context: contextValue });
      return;
    }
    if (!targetSubject) return;
    onCreate({ subject: sourceSubject, object: targetSubject, relationType, context: contextValue });
  };

  return (
    <div className={styles.dialogOverlay} onClick={onCancel}>
      <form className={styles.dialog} onSubmit={handleSubmit} onClick={(event) => event.stopPropagation()}>
        <div className={styles.dialogHeader}>
          <h3 className={styles.dialogTitle}>{mode === 'edit' ? 'Edit relation' : 'Create relation'}</h3>
          <IconButton
            className={styles.closeButton}
            onClick={onCancel}
            title="Close"
            aria-label="Close"
            variant="secondary"
            size="sm"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </IconButton>
        </div>

        <div className={styles.subjectLine}>
          <span>{sourceLabel}</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 12h14" />
            <path d="m12 5 7 7-7 7" />
          </svg>
          <span>{targetSubject ? getSubjectLabel(targetSubject, assets, variants) : 'Select target'}</span>
        </div>

        <div className={styles.field}>
          <span>Type</span>
          <UiSelect
            value={relationType}
            options={RELATION_TYPES}
            onValueChange={setRelationType}
            label="Type"
            fullWidth
          />
        </div>

        {mode === 'create' && (
          <div className={styles.targetPicker}>
            <label className={styles.field}>
              <span>Target</span>
              <input
                type="search"
                placeholder="Search assets and variants"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className={styles.targetOptions}>
              {options.map((option) => {
                const selected = targetSubject && subjectKey(targetSubject) === subjectKey(option.subject);
                return (
                  <button
                    key={option.key}
                    type="button"
                    className={`${styles.targetOption} ${selected ? styles.targetOptionSelected : ''}`}
                    onClick={() => setTargetSubject(option.subject)}
                  >
                    <Thumbnail variant={option.variant} size="xs" className={styles.targetThumb} />
                    <span className={styles.targetText}>
                      <span>{option.title}</span>
                      <small>{option.subtitle}</small>
                    </span>
                  </button>
                );
              })}
              {options.length === 0 && <div className={styles.emptyTarget}>No matching targets</div>}
            </div>
          </div>
        )}

        {mode === 'create' && targetSubject && (
          <div className={styles.quickRelations} aria-label="Relation shortcuts">
            {COMMON_RELATION_SHORTCUT_TYPES.map((shortcut) => {
              const fullLabel = buildImmediateRelationLabel(shortcut.type, getSubjectLabel(targetSubject, assets, variants));
              return (
                <Button
                  key={shortcut.type}
                  className={styles.quickRelationButton}
                  onClick={() => onCreate({
                    subject: sourceSubject,
                    object: targetSubject,
                    relationType: shortcut.type,
                    context: null,
                  })}
                  variant="secondary"
                  size="sm"
                  title={fullLabel}
                  aria-label={fullLabel}
                >
                  {getRelationShortcutLabel(shortcut.type)}
                </Button>
              );
            })}
          </div>
        )}

        <label className={styles.field}>
          <span>Label</span>
          <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="UI thumbnail" />
        </label>
        <label className={styles.field}>
          <span>Context</span>
          <input value={context} onChange={(event) => setContext(event.target.value)} placeholder="inventory grid" />
        </label>
        <label className={styles.field}>
          <span>Notes</span>
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
        </label>

        <div className={styles.dialogActions}>
          <Button className={styles.dialogActionButton} onClick={onCancel} variant="secondary">Cancel</Button>
          <Button type="submit" className={styles.dialogActionButton} disabled={!canSubmit} variant="primary">
            {mode === 'edit' ? 'Save' : 'Create'}
          </Button>
        </div>
      </form>
    </div>
  );
}
