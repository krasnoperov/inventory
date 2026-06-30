/**
 * VariantDetailsPanel - fixed inspector for a selected variant.
 *
 * Rendered through a portal to document.body so it escapes the React Flow
 * canvas transform: it stays pinned to the viewport and, crucially, does NOT
 * scale with canvas zoom — so the prompt and creation history stay readable no
 * matter how far the image is zoomed. The on-canvas node owns zoom; this panel
 * owns legibility.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  type Asset,
  type Composition,
  type CompositionItem,
  type CompositionOverview,
  type Lineage,
  type SpaceSubject,
  type Variant,
  getVariantMediaUrl,
  isVariantImageReady,
  isVariantReady,
  isVariantForgeTrayReady,
} from '../../hooks/useSpaceWebSocket';
import { formatMediaKind } from '../../mediaKind';
import { formatUtcDateTime } from '../../lib/dates';
import { formatBytes } from '../../lib/format';
import { ImageLightbox } from '../ImageLightbox';
import { CompositionPlacementControl } from '../CompositionPlacementControl';
import { getAudioCardMetadata } from '../assetCardMetadata';
import { Button, IconButton } from '../../ui';
import type { CompositionShortcut } from '../../productionShortcuts';
import { buildAncestryTrail } from './variantLineage';
import styles from './VariantDetailsPanel.module.css';

export interface VariantDetailsPanelProps {
  variant: Variant;
  asset: Asset;
  spaceId?: string;
  isActive?: boolean;
  /** Total variants on the canvas (delete is disabled when only one remains). */
  variantCount?: number;
  lineage: Lineage[];
  /** All variants in the space, for resolving lineage ancestors. */
  allVariants?: Variant[];
  /** All assets in the space, for labelling lineage ancestors. */
  allAssets?: Asset[];
  onClose: () => void;
  onStarVariant?: (variantId: string, starred: boolean) => void;
  onDeleteVariant?: (variant: Variant) => void;
  onCreateRelation?: (subject: SpaceSubject) => void;
  onAddVariantToCollection?: (variant: Variant) => void;
  onAddToTray?: (variant: Variant, asset: Asset) => void;
  onSetActive?: (variantId: string) => void;
  compositions?: Array<Composition | CompositionOverview>;
  compositionItems?: CompositionItem[];
  onPlaceInComposition?: (variant: Variant, shortcut: CompositionShortcut) => void;
}

const RELATION_LABELS: Record<Lineage['relation_type'], string> = {
  derived: 'Derived from',
  refined: 'Refined from',
  forked: 'Forked from',
};

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      className={styles.starIcon}
      viewBox="0 0 24 24"
      width="14"
      height="14"
      aria-hidden="true"
    >
      <path d="M12 3.2l2.55 5.17 5.7.83-4.13 4.02.98 5.68L12 16.22 6.9 18.9l.98-5.68L3.75 9.2l5.7-.83L12 3.2z" />
      {!filled && (
        <path
          className={styles.starIconCutout}
          d="M12 6.58l-1.51 3.06-3.38.49 2.45 2.39-.58 3.36L12 14.29l3.02 1.59-.58-3.36 2.45-2.39-3.38-.49L12 6.58z"
        />
      )}
    </svg>
  );
}

export function VariantDetailsPanel({
  variant,
  asset,
  spaceId,
  isActive,
  variantCount = 0,
  lineage,
  allVariants,
  allAssets,
  onClose,
  onStarVariant,
  onDeleteVariant,
  onCreateRelation,
  onAddVariantToCollection,
  onAddToTray,
  onSetActive,
  compositions,
  compositionItems,
  onPlaceInComposition,
}: VariantDetailsPanelProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [showRawMeta, setShowRawMeta] = useState(false);
  // Fallback image dimensions when the variant has none stored (e.g. uploads).
  const [measuredDims, setMeasuredDims] = useState<{ width: number; height: number } | null>(null);

  // Close on Escape, like the lightbox, so the panel is keyboard-dismissable.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Lazily measure real dimensions only when the variant has no stored
  // media_width/height (most generated variants store these).
  useEffect(() => {
    setMeasuredDims(null);
    if (variant.media_width && variant.media_height) return;
    if (!isVariantImageReady(variant)) return;
    const url = getVariantMediaUrl(variant, spaceId);
    if (!url) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) setMeasuredDims({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.src = url;
    return () => {
      cancelled = true;
    };
  }, [variant, spaceId]);

  const recipe = useMemo(() => parseJsonObject(variant.recipe), [variant.recipe]);
  const audioMetadata = useMemo(() => getAudioCardMetadata(variant), [variant]);
  const isAudioVariant = variant.media_kind === 'audio';
  const prompt = isAudioVariant
    ? audioMetadata.prompt
    : (typeof recipe?.prompt === 'string' ? recipe.prompt : null);
  const keyFacts = useMemo(() => extractKeyFacts(variant, recipe), [variant, recipe]);
  const visibleKeyFacts = useMemo(() => {
    if (!isAudioVariant || !audioMetadata.model) return keyFacts;
    return keyFacts.filter((fact) => fact.toLowerCase() !== audioMetadata.model?.toLowerCase());
  }, [audioMetadata.model, isAudioVariant, keyFacts]);
  const audioFacts = useMemo(
    () => [
      audioMetadata.name ? ['Name', audioMetadata.name] : null,
      audioMetadata.model ? ['Model', audioMetadata.model] : null,
      audioMetadata.voice ? ['Voice', audioMetadata.voice] : null,
    ].filter((fact): fact is [string, string] => Boolean(fact)),
    [audioMetadata.name, audioMetadata.model, audioMetadata.voice],
  );

  const dimWidth = variant.media_width ?? measuredDims?.width ?? null;
  const dimHeight = variant.media_height ?? measuredDims?.height ?? null;
  const dimensionsLabel = dimWidth && dimHeight ? `${dimWidth}×${dimHeight}` : null;
  const sizeLabel = formatBytes(variant.media_size_bytes);

  const canViewFullSize = isVariantImageReady(variant);
  const fullSizeUrl = canViewFullSize ? getVariantMediaUrl(variant, spaceId) : undefined;
  const lightboxCaption = [asset.name, dimensionsLabel, sizeLabel].filter(Boolean).join(' · ');

  // Creation history: walk the lineage chain up to the root.
  const variantsById = useMemo(() => {
    const map = new Map<string, Variant>();
    for (const v of allVariants ?? []) map.set(v.id, v);
    return map;
  }, [allVariants]);
  const assetsById = useMemo(() => {
    const map = new Map<string, Asset>();
    for (const a of allAssets ?? []) map.set(a.id, a);
    return map;
  }, [allAssets]);
  const history = useMemo(() => buildAncestryTrail(variant.id, lineage), [variant.id, lineage]);

  // Pretty-printed raw metadata so the full provenance is readable (no
  // truncation) once the user opens the disclosure.
  const provenanceJson = useMemo(() => prettyJson(variant.generation_provenance), [variant.generation_provenance]);
  const providerJson = useMemo(() => prettyJson(variant.provider_metadata), [variant.provider_metadata]);
  const recipeJson = useMemo(() => prettyJson(variant.recipe), [variant.recipe]);

  const handleStarClick = useCallback(() => {
    onStarVariant?.(variant.id, !variant.starred);
  }, [variant.id, variant.starred, onStarVariant]);

  const handleDeleteClick = useCallback(() => {
    onDeleteVariant?.(variant);
  }, [variant, onDeleteVariant]);

  const handleCreateRelationClick = useCallback(() => {
    onCreateRelation?.({ subjectType: 'variant', variantId: variant.id });
  }, [onCreateRelation, variant.id]);

  const handleAddVariantToCollectionClick = useCallback(() => {
    onAddVariantToCollection?.(variant);
  }, [onAddVariantToCollection, variant]);

  const handleAddToTray = useCallback(() => {
    if (isVariantForgeTrayReady(variant)) onAddToTray?.(variant, asset);
  }, [variant, asset, onAddToTray]);

  const handleSetActive = useCallback(() => {
    if (isVariantReady(variant)) onSetActive?.(variant.id);
  }, [variant, onSetActive]);

  return createPortal(
    <aside className={styles.panel} aria-label="Variant details">
      <IconButton className={styles.closeButton} onClick={onClose} title="Close" aria-label="Close variant details" variant="ghost" size="sm">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </IconButton>

      <div className={styles.scroll}>
        {/* Actions Row */}
        <div className={styles.actions}>
          {canViewFullSize && (
            <IconButton className={styles.actionButton} onClick={() => setLightboxOpen(true)} title="View full size" aria-label="View full size" variant="ghost">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
              </svg>
            </IconButton>
          )}
          <IconButton
            className={`${styles.actionButton} ${variant.starred ? styles.starred : ''}`}
            onClick={handleStarClick}
            title={variant.starred ? 'Unstar' : 'Star'}
            aria-label={variant.starred ? 'Unstar variant' : 'Star variant'}
            aria-pressed={variant.starred}
            variant="ghost"
          >
            <StarIcon filled={variant.starred} />
          </IconButton>
          <a
            className={styles.actionButton}
            href={getVariantMediaUrl(variant, spaceId)}
            download={`${asset.name}-${variant.id.slice(0, 8)}`}
            title="Download"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </a>
          {onAddToTray && isVariantForgeTrayReady(variant) && (
            <IconButton className={styles.actionButton} onClick={handleAddToTray} title="Add to Tray" aria-label="Add to Tray" variant="ghost">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </IconButton>
          )}
          {onCreateRelation && (
            <IconButton className={styles.actionButton} onClick={handleCreateRelationClick} title="Create relation" aria-label="Create relation" variant="ghost">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                <path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11 4.93" />
                <path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07L13 19.07" />
              </svg>
            </IconButton>
          )}
          {onAddVariantToCollection && (
            <IconButton
              className={styles.actionButton}
              onClick={handleAddVariantToCollectionClick}
              title="Select variant for collection placement"
              aria-label="Select variant for collection placement"
              variant="ghost"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                <path d="M4 6h16" />
                <path d="M4 12h10" />
                <path d="M4 18h7" />
                <path d="M18 15v6" />
                <path d="M15 18h6" />
              </svg>
            </IconButton>
          )}
          {!isActive && onSetActive && (
            <IconButton
              className={`${styles.actionButton} ${styles.setActive}`}
              onClick={handleSetActive}
              title="Use as main variant"
              aria-label="Use as main variant"
              variant="ghost"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </IconButton>
          )}
          {onDeleteVariant && variantCount > 1 && (
            <IconButton
              className={`${styles.actionButton} ${styles.delete}`}
              onClick={handleDeleteClick}
              title="Delete"
              aria-label="Delete variant"
              variant="ghost"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              </svg>
            </IconButton>
          )}
        </div>

        {/* Metadata - when · kind · dimensions · size */}
        <div className={styles.meta}>
          <span className={styles.date}>{formatUtcDateTime(variant.created_at)}</span>
          <span className={styles.chip}>{formatMediaKind(variant.media_kind)}</span>
          {dimensionsLabel && <span className={styles.chip}>{dimensionsLabel}</span>}
          {sizeLabel && <span className={styles.chip}>{sizeLabel}</span>}
        </div>

        {/* Place this finished variant into a composition (post-generation) */}
        {onPlaceInComposition && compositions && compositions.length > 0 && isVariantReady(variant) && (
          <CompositionPlacementControl
            compositions={compositions}
            compositionItems={compositionItems ?? []}
            variant={variant}
            onPlace={onPlaceInComposition}
          />
        )}

        {isAudioVariant && audioFacts.length > 0 && (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Audio</h3>
            <dl className={styles.audioFacts}>
              {audioFacts.map(([label, value]) => (
                <div key={label} className={styles.audioFact}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {/* Prompt - full text, no truncation */}
        {prompt && (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Prompt</h3>
            <p className={styles.prompt}>{prompt}</p>
          </section>
        )}

        {/* Key facts - operation · type · provider · model */}
        {visibleKeyFacts.length > 0 && (
          <div className={styles.facts}>
            {visibleKeyFacts.map((fact) => (
              <span key={fact} className={styles.chip}>{fact}</span>
            ))}
          </div>
        )}

        {/* Creation history - full lineage chain, oldest → this variant */}
        {history.length > 0 && (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Creation history</h3>
            <ol className={styles.history}>
              {history.map((step) => {
                const ancestor = variantsById.get(step.variantId);
                const ancestorAsset = ancestor ? assetsById.get(ancestor.asset_id) : undefined;
                const label = ancestorAsset?.name ?? `Variant ${step.variantId.slice(0, 8)}`;
                return (
                  <li key={step.variantId} className={styles.historyRow}>
                    <span className={styles.historyRelation}>{RELATION_LABELS[step.relationType]}</span>
                    <span className={styles.historyLabel}>{label}</span>
                    {ancestor && (
                      <span className={styles.historyDate}>{formatUtcDateTime(ancestor.created_at)}</span>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        {/* Description */}
        {variant.description && (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Description</h3>
            <p className={styles.description}>{variant.description}</p>
          </section>
        )}

        {/* Raw metadata - full JSON behind a disclosure */}
        {(provenanceJson || providerJson || recipeJson) && (
          <div className={styles.raw}>
            <Button
              className={styles.rawToggle}
              onClick={() => setShowRawMeta((prev) => !prev)}
              aria-expanded={showRawMeta}
              variant="ghost"
              size="sm"
            >
              <svg
                className={`${styles.rawChevron} ${showRawMeta ? styles.rawChevronOpen : ''}`}
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
              Raw metadata
            </Button>
            {showRawMeta && (
              <div className={styles.rawBody}>
                {recipeJson && (
                  <div className={styles.rawRow}>
                    <span>Recipe</span>
                    <pre>{recipeJson}</pre>
                  </div>
                )}
                {provenanceJson && (
                  <div className={styles.rawRow}>
                    <span>Provenance</span>
                    <pre>{provenanceJson}</pre>
                  </div>
                )}
                {providerJson && (
                  <div className={styles.rawRow}>
                    <span>Provider</span>
                    <pre>{providerJson}</pre>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {lightboxOpen && fullSizeUrl && (
        <ImageLightbox
          src={fullSizeUrl}
          alt={asset.name}
          caption={lightboxCaption}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </aside>,
    document.body,
  );
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

/** Pretty-print a JSON string; returns null for empty/empty-object metadata. */
function prettyJson(value: string | null | undefined): string | null {
  const parsed = parseJsonObject(value);
  if (!parsed || Object.keys(parsed).length === 0) return null;
  return JSON.stringify(parsed, null, 2);
}

/**
 * Pull the few high-value facts (operation, asset type, provider, model) out of
 * the verbose provenance/provider metadata for the compact chip row. Falls back
 * across sources and de-dupes so chips stay lean.
 */
function extractKeyFacts(variant: Variant, recipe: Record<string, unknown> | null): string[] {
  const prov = parseJsonObject(variant.generation_provenance);
  const provider = parseJsonObject(variant.provider_metadata);
  const facts: string[] = [];
  const add = (value: unknown) => {
    if (value === undefined || value === null || typeof value === 'object') return;
    const text = String(value).trim();
    if (text && !facts.some((f) => f.toLowerCase() === text.toLowerCase())) facts.push(text);
  };
  add(prov?.operation);
  add(prov?.assetType);
  add(provider?.provider ?? prov?.modelProvider);
  add(recipe?.model ?? provider?.model ?? prov?.model);
  return facts;
}

export default VariantDetailsPanel;
