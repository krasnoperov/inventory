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
import { Button, IconButton, TextArea, TextInput, UiSelect, type SelectOption } from '../ui';
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

function getSubjectName(subject: SpaceSubject, assets: Asset[], variants: Variant[]): string {
  if (subject.subjectType === 'asset') {
    return assets.find((asset) => asset.id === subject.assetId)?.name ?? 'Missing asset';
  }

  const variant = variants.find((entry) => entry.id === subject.variantId);
  const asset = variant ? assets.find((entry) => entry.id === variant.asset_id) : null;
  return asset?.name ?? 'Missing asset';
}

function getSubjectScope(subject: SpaceSubject): string {
  return subject.subjectType === 'asset' ? 'Asset' : 'Variant';
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

function RelationSubjectChip({
  subject,
  assets,
  variants,
  placeholder = 'Select target',
}: {
  subject: SpaceSubject | null;
  assets: Asset[];
  variants: Variant[];
  placeholder?: string;
}) {
  if (!subject) {
    return <span className={styles.subjectChip}>{placeholder}</span>;
  }

  return (
    <span className={styles.subjectChip}>
      <span className={styles.subjectChipName}>{getSubjectName(subject, assets, variants)}</span>
      <span className={styles.subjectChipScope}>{getSubjectScope(subject)}</span>
    </span>
  );
}

type RelationDirection = 'outgoing' | 'incoming' | 'both';

interface RelationEntry {
  relation: SpaceRelation;
  direction: RelationDirection;
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
  const relationEntries = useMemo<RelationEntry[]>(() => {
    const outgoingIds = new Set(outgoing.map((relation) => relation.id));
    const incomingIds = new Set(incoming.map((relation) => relation.id));
    const entries = [...outgoing, ...incoming].reduce<Map<string, RelationEntry>>((map, relation) => {
      if (map.has(relation.id)) return map;
      map.set(relation.id, {
        relation,
        direction: outgoingIds.has(relation.id) && incomingIds.has(relation.id)
          ? 'both'
          : outgoingIds.has(relation.id) ? 'outgoing' : 'incoming',
      });
      return map;
    }, new Map());
    return Array.from(entries.values());
  }, [incoming, outgoing]);
  const relationCount = relationEntries.length;

  return (
    <section className={styles.panel} aria-label="Manual relations">
      <div className={styles.header}>
        <h2 className={styles.title}>
          Relations
          <span className={styles.countBadge}>{relationCount}</span>
        </h2>
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
      {relationCount === 0 ? (
        <div className={styles.compactEmpty}>None</div>
      ) : (
        <RelationRows
          entries={relationEntries}
          assets={assets}
          variants={variants}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      )}
    </section>
  );
}

function RelationRows({
  entries,
  assets,
  variants,
  onEdit,
  onDelete,
}: {
  entries: RelationEntry[];
  assets: Asset[];
  variants: Variant[];
  onEdit: (relation: SpaceRelation) => void;
  onDelete: (relationId: string) => void;
}) {
  return (
    <div className={styles.rows}>
      {entries.map(({ relation, direction }) => {
          const source = relationSubject(relation);
          const target = relationObject(relation);
          const context = parseRelationContext(relation.context);
          const relationTypeLabel = getRelationTypeLabel(relation.relation_type);
          const sourceLabel = getSubjectLabel(source, assets, variants);
          const targetLabel = getSubjectLabel(target, assets, variants);
          const relatedSubject = direction === 'outgoing'
            ? targetLabel
            : direction === 'incoming'
              ? sourceLabel
              : null;
          return (
            <RelationRow
              key={relation.id}
              relation={relation}
              direction={direction}
              relationTypeLabel={relationTypeLabel}
              sourceLabel={sourceLabel}
              targetLabel={targetLabel}
              relatedSubject={relatedSubject}
              context={context}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          );
        })}
    </div>
  );
}

function RelationRow({
  relation,
  direction,
  relationTypeLabel,
  sourceLabel,
  targetLabel,
  relatedSubject,
  context,
  onEdit,
  onDelete,
}: {
  relation: SpaceRelation;
  direction: RelationDirection;
  relationTypeLabel: string;
  sourceLabel: string;
  targetLabel: string;
  relatedSubject: string | null;
  context: SpaceRelationContext;
  onEdit: (relation: SpaceRelation) => void;
  onDelete: (relationId: string) => void;
}) {
  return (
    <article className={styles.row}>
      <div className={styles.rowMain}>
        <span className={styles.directionBadge}>
          {direction === 'outgoing' ? 'Out' : direction === 'incoming' ? 'In' : 'Both'}
        </span>
        <div className={styles.rowText}>
          <div className={styles.rowTitle}>
            {direction === 'both' ? (
              <>
                <span className={styles.relatedSubject}>{sourceLabel}</span>
                <span className={styles.relationSeparator} aria-hidden="true" />
                <span className={styles.relationType}>{relationTypeLabel}</span>
                <span className={styles.relationSeparator} aria-hidden="true" />
                <span className={styles.relatedSubject}>{targetLabel}</span>
              </>
            ) : (
              <>
                {direction === 'incoming' && relatedSubject && <span className={styles.relatedSubject}>{relatedSubject}</span>}
                <span className={styles.relationSeparator} aria-hidden="true" />
                <span className={styles.relationType}>{relationTypeLabel}</span>
                <span className={styles.relationSeparator} aria-hidden="true" />
                {direction === 'outgoing' && relatedSubject && <span className={styles.relatedSubject}>{relatedSubject}</span>}
              </>
            )}
          </div>
          {context.label && <div className={styles.rowLabel}>{context.label}</div>}
          {context.context && <div className={styles.rowMeta}>{context.context}</div>}
          {context.notes && <div className={styles.rowNotes}>{context.notes}</div>}
        </div>
      </div>
      <div className={styles.rowActions}>
        <IconButton
          className={styles.rowButton}
          onClick={() => onEdit(relation)}
          variant="ghost"
          size="sm"
          title="Edit relation"
          aria-label="Edit relation"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </IconButton>
        <IconButton
          className={styles.rowButton}
          onClick={() => onDelete(relation.id)}
          variant="ghost"
          size="sm"
          title="Clear relation"
          aria-label="Clear relation"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 6h18" />
            <path d="M8 6V4h8v2" />
            <path d="M19 6l-1 14H6L5 6" />
            <path d="M10 11v5" />
            <path d="M14 11v5" />
          </svg>
        </IconButton>
      </div>
    </article>
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
  const hasExistingContext = Boolean(existingContext.label || existingContext.context || existingContext.notes);
  const [relationType, setRelationType] = useState<SpaceRelationType>(relation?.relation_type ?? 'reference_for');
  const [targetSubject, setTargetSubject] = useState<SpaceSubject | null>(relation ? relationObject(relation) : null);
  const [query, setQuery] = useState('');
  const [label, setLabel] = useState(existingContext.label ?? '');
  const [context, setContext] = useState(existingContext.context ?? '');
  const [notes, setNotes] = useState(existingContext.notes ?? '');
  const [detailsOpen, setDetailsOpen] = useState(mode === 'edit' || hasExistingContext);

  const canSubmit = mode === 'edit' || targetSubject !== null;
  const normalizedQuery = query.trim().toLowerCase();
  const options = useMemo(() => {
    const assetOptions = assets.map((asset) => ({
      key: `asset:${asset.id}`,
      subject: { subjectType: 'asset', assetId: asset.id } satisfies SpaceSubject,
      title: asset.name,
      subtitle: `Asset · ${asset.type} / ${formatMediaKind(asset.media_kind)}`,
      variant: getAssetVariant(asset, variants),
    }));
    const variantOptions = variants.map((variant) => {
      const asset = assets.find((entry) => entry.id === variant.asset_id);
      return {
        key: `variant:${variant.id}`,
        subject: { subjectType: 'variant', variantId: variant.id } satisfies SpaceSubject,
        title: asset?.name ?? 'Missing asset',
        subtitle: `Variant ${variant.id.slice(0, 8)} · ${formatMediaKind(variant.media_kind)}`,
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

        <div className={styles.subjectLine} aria-label="Relation endpoints">
          <RelationSubjectChip subject={sourceSubject} assets={assets} variants={variants} />
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 12h14" />
            <path d="m12 5 7 7-7 7" />
          </svg>
          <RelationSubjectChip subject={targetSubject} assets={assets} variants={variants} />
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
              <TextInput
                type="search"
                placeholder="Search assets and variants"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                fullWidth
              />
            </label>
            <div className={styles.targetOptions}>
              {options.map((option) => {
                const selected = targetSubject && subjectKey(targetSubject) === subjectKey(option.subject);
                return (
                  <Button
                    key={option.key}
                    className={`${styles.targetOption} ${selected ? styles.targetOptionSelected : ''}`}
                    onClick={() => setTargetSubject(option.subject)}
                    variant="ghost"
                    aria-pressed={selected ? 'true' : undefined}
                  >
                    <Thumbnail variant={option.variant} size="xs" className={styles.targetThumb} />
                    <span className={styles.targetText}>
                      <span>{option.title}</span>
                      <small>{option.subtitle}</small>
                    </span>
                  </Button>
                );
              })}
              {options.length === 0 && <div className={styles.emptyTarget}>No matching targets</div>}
            </div>
          </div>
        )}

        {mode === 'create' && (
          <Button
            className={styles.detailsToggle}
            variant="ghost"
            size="sm"
            aria-expanded={detailsOpen}
            aria-controls="relation-metadata-fields"
            onClick={() => setDetailsOpen((current) => !current)}
          >
            <span>{detailsOpen ? 'Hide details' : 'Details'}</span>
          </Button>
        )}

        {detailsOpen && (
          <div id="relation-metadata-fields" className={styles.detailsFields}>
            <label className={styles.field}>
              <span>Label</span>
              <TextInput
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="UI thumbnail"
                fullWidth
              />
            </label>
            <label className={styles.field}>
              <span>Context</span>
              <TextInput
                value={context}
                onChange={(event) => setContext(event.target.value)}
                placeholder="inventory grid"
                fullWidth
              />
            </label>
            <label className={styles.field}>
              <span>Notes</span>
              <TextArea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={3}
                compact
                fullWidth
              />
            </label>
          </div>
        )}

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
