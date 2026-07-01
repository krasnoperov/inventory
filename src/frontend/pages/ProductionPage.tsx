import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiFetchError } from '../../api/client';
import { HeaderNav } from '../components/HeaderNav';
import { Link } from '../components/Link';
import { Thumbnail } from '../components/Thumbnail';
import { UsageIndicator } from '../components/UsageIndicator';
import { WorkspaceChrome } from '../components/WorkspaceChrome';
import { useAuth } from '../contexts/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useNavigate } from '../hooks/useNavigate';
import { useParams } from '../hooks/useParams';
import {
  getVariantMediaUrl,
  isVariantReady,
  type Asset,
  type Variant,
} from '../hooks/useSpaceWebSocket';
import { useSpaceWebSocket } from '../hooks/useSpaceWebSocket';
import { formatMediaKind } from '../mediaKind';
import {
  createProductionHandoff,
  formatDuration,
  formatRemotionSceneArgs,
  formatTimelineOffset,
  parseJsonStringArray,
  sortProductionRecords,
  type ProductionRecord,
} from '../productionHandoff';
import { productionRecordsQueryOptions, spacePageQueryOptions } from '../queries';
import { Button, IconButton, TextArea, TextInput, UiSelect, type SelectOption } from '../ui';
import styles from './ProductionPage.module.css';

interface PlacementFormState {
  id: string;
  variantId: string;
  shotId: string;
  sceneLabel: string;
  timelineStartMs: string;
  durationMs: string;
  motionPrompt: string;
  sourceRefs: string;
  sourceVariantIds: string;
}

interface VariantOption {
  variant: Variant;
  asset: Asset;
  label: string;
}

interface ProductionPlacementControlsProps {
  activeProductionId: string;
  canEdit: boolean;
  form: PlacementFormState;
  formError: string | null;
  isSaving: boolean;
  onFormChange: <K extends keyof PlacementFormState>(key: K, value: PlacementFormState[K]) => void;
  onNewPlacement: () => void;
  onSubmit: () => void;
  onVariantChange: (variantId: string) => void;
  selectedOption: VariantOption | null;
  spaceId: string;
  variantOptions: VariantOption[];
}

interface ProductionHandoffControlsProps {
  copyStatus: string | null;
  handoff: ReturnType<typeof createProductionHandoff> | null;
  handoffJson: string;
  onCopyText: (label: string, value: string) => void;
  sceneArgs: string;
  sortedRecords: ProductionRecord[];
}

const emptyForm: PlacementFormState = {
  id: '',
  variantId: '',
  shotId: '',
  sceneLabel: '',
  timelineStartMs: '0',
  durationMs: '',
  motionPrompt: '',
  sourceRefs: '',
  sourceVariantIds: '',
};

function splitList(value: string): string[] {
  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function parseNonNegativeInteger(value: string, field: string): number {
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return numberValue;
}

function recordToForm(record: ProductionRecord): PlacementFormState {
  return {
    id: record.id,
    variantId: record.variant_id,
    shotId: record.shot_id || '',
    sceneLabel: record.scene_label,
    timelineStartMs: String(record.timeline_start_ms),
    durationMs: record.duration_ms === null ? '' : String(record.duration_ms),
    motionPrompt: record.motion_prompt || '',
    sourceRefs: parseJsonStringArray(record.source_refs).join(', '),
    sourceVariantIds: parseJsonStringArray(record.source_variant_ids).join(', '),
  };
}

export function ProductionPlacementControls({
  activeProductionId,
  canEdit,
  form,
  formError,
  isSaving,
  onFormChange,
  onNewPlacement,
  onSubmit,
  onVariantChange,
  selectedOption,
  spaceId,
  variantOptions,
}: ProductionPlacementControlsProps) {
  const variantSelectOptions = useMemo<Array<SelectOption<string>>>(() => [
    { value: '', label: 'Select completed media...' },
    ...variantOptions.map(option => ({
      value: option.variant.id,
      label: option.label,
    })),
  ], [variantOptions]);

  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <h2>{form.id ? 'Edit Placement' : 'Manual Placement'}</h2>
        {form.id && (
          <Button size="sm" variant="ghost" onClick={onNewPlacement}>
            New
          </Button>
        )}
      </div>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <label className={styles.field}>
          <span>Variant</span>
          <UiSelect
            value={form.variantId}
            options={variantSelectOptions}
            onValueChange={onVariantChange}
            disabled={!canEdit || variantOptions.length === 0}
            label="Variant"
            fullWidth
          />
        </label>

        {selectedOption && (
          <div className={styles.selectedPreview}>
            <Thumbnail
              variant={selectedOption.variant}
              size="sm"
              spaceId={spaceId}
              showAudioControls
              showVideoControls
            />
            <div>
              <strong>{selectedOption.asset.name}</strong>
              <span>{selectedOption.asset.type} / {formatMediaKind(selectedOption.variant.media_kind)}</span>
              {getVariantMediaUrl(selectedOption.variant, spaceId) && (
                <a href={getVariantMediaUrl(selectedOption.variant, spaceId)} target="_blank" rel="noreferrer">
                  Open media
                </a>
              )}
            </div>
          </div>
        )}

        <div className={styles.inlineFields}>
          <label className={styles.field}>
            <span>Shot ID</span>
            <TextInput
              value={form.shotId}
              onChange={(event) => onFormChange('shotId', event.target.value)}
              placeholder="shot-001"
              disabled={!canEdit}
              fullWidth
            />
          </label>
          <label className={styles.field}>
            <span>Scene Label</span>
            <TextInput
              value={form.sceneLabel}
              onChange={(event) => onFormChange('sceneLabel', event.target.value)}
              placeholder="Market"
              disabled={!canEdit}
              required
              fullWidth
            />
          </label>
        </div>

        <div className={styles.inlineFields}>
          <label className={styles.field}>
            <span>Start ms</span>
            <TextInput
              type="number"
              min="0"
              step="1"
              value={form.timelineStartMs}
              onChange={(event) => onFormChange('timelineStartMs', event.target.value)}
              disabled={!canEdit}
              required
              fullWidth
            />
          </label>
          <label className={styles.field}>
            <span>Duration ms</span>
            <TextInput
              type="number"
              min="0"
              step="1"
              value={form.durationMs}
              onChange={(event) => onFormChange('durationMs', event.target.value)}
              placeholder="optional"
              disabled={!canEdit}
              fullWidth
            />
          </label>
        </div>

        <label className={styles.field}>
          <span>Motion Prompt</span>
          <TextArea
            value={form.motionPrompt}
            onChange={(event) => onFormChange('motionPrompt', event.target.value)}
            placeholder="Camera move, action note, or renderer instruction"
            disabled={!canEdit}
            rows={3}
            compact
            fullWidth
          />
        </label>

        <label className={styles.field}>
          <span>Source Refs</span>
          <TextInput
            value={form.sourceRefs}
            onChange={(event) => onFormChange('sourceRefs', event.target.value)}
            placeholder="references/source.png, script.md"
            disabled={!canEdit}
            fullWidth
          />
        </label>

        <label className={styles.field}>
          <span>Source Variant IDs</span>
          <TextInput
            value={form.sourceVariantIds}
            onChange={(event) => onFormChange('sourceVariantIds', event.target.value)}
            placeholder="variant-id-1, variant-id-2"
            disabled={!canEdit}
            fullWidth
          />
        </label>

        {formError && <p className={styles.formError}>{formError}</p>}
        {!canEdit && <p className={styles.muted}>Viewer access can inspect records but cannot place or delete them.</p>}

        <div className={styles.formActions}>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={!canEdit || !activeProductionId || isSaving}
          >
            {isSaving ? 'Saving...' : form.id ? 'Update Placement' : 'Place Variant'}
          </Button>
        </div>
      </form>
    </section>
  );
}

export function ProductionHandoffControls({
  copyStatus,
  handoff,
  handoffJson,
  onCopyText,
  sceneArgs,
  sortedRecords,
}: ProductionHandoffControlsProps) {
  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <h2>Media Handoff</h2>
        <div className={styles.panelHeaderActions}>
          {copyStatus && <span className={styles.copyStatus}>{copyStatus}</span>}
          <div className={styles.copyActions}>
            <Button
              size="sm"
              onClick={() => onCopyText('JSON', handoffJson)}
              disabled={!handoff || sortedRecords.length === 0}
            >
              Copy JSON
            </Button>
            <Button
              size="sm"
              onClick={() => onCopyText('Scene args', sceneArgs)}
              disabled={!sceneArgs}
            >
              Copy Scene Args
            </Button>
          </div>
        </div>
      </div>
      <pre className={styles.handoffPreview}>{handoffJson || 'No handoff data loaded.'}</pre>
    </section>
  );
}

export default function ProductionPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const params = useParams();
  const spaceId = params.id;
  const queryClient = useQueryClient();
  const [productionId, setProductionId] = useState('');
  const activeProductionId = productionId.trim();
  const [form, setForm] = useState<PlacementFormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  const spaceDataQuery = useQuery({
    ...spacePageQueryOptions(spaceId || ''),
    enabled: Boolean(user && spaceId),
  });
  const space = spaceDataQuery.data?.space ?? null;
  const isLoadingSpace = spaceDataQuery.isPending;
  const spaceError = spaceDataQuery.error instanceof Error ? spaceDataQuery.error.message : null;

  useDocumentTitle(space ? `${space.name} Production` : 'Production');

  const {
    status: wsStatus,
    assets,
    variants,
  } = useSpaceWebSocket({
    spaceId: spaceId || '',
    syncMode: 'full',
    sessionUpdateOnConnect: { viewingAssetId: null, viewingVariantId: null },
  });

  const recordsQuery = useQuery({
    ...productionRecordsQueryOptions(spaceId || '', activeProductionId),
    enabled: Boolean(user && spaceId && activeProductionId),
  });

  const canEdit = space?.role === 'owner' || space?.role === 'editor';
  const assetById = useMemo(() => new Map(assets.map(asset => [asset.id, asset])), [assets]);
  const variantById = useMemo(() => new Map(variants.map(variant => [variant.id, variant])), [variants]);
  const sortedRecords = useMemo(
    () => sortProductionRecords(recordsQuery.data || []),
    [recordsQuery.data],
  );
  const variantOptions = useMemo<VariantOption[]>(() => {
    return variants
      .filter(isVariantReady)
      .map((variant) => {
        const asset = assetById.get(variant.asset_id);
        if (!asset) return null;
        return {
          variant,
          asset,
          label: `${asset.name} (${formatMediaKind(variant.media_kind)})`,
        };
      })
      .filter((option): option is VariantOption => option !== null)
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [assetById, variants]);

  const selectedOption = variantOptions.find(option => option.variant.id === form.variantId) || null;
  const handoff = useMemo(() => {
    if (!spaceId || !activeProductionId) return null;
    return createProductionHandoff({
      spaceId,
      productionId: activeProductionId,
      records: sortedRecords,
      assets,
      variants,
      baseUrl: typeof window === 'undefined' ? undefined : window.location.origin,
    });
  }, [activeProductionId, assets, sortedRecords, spaceId, variants]);

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    if (!spaceId) {
      navigate('/');
    }
  }, [navigate, spaceId, user]);

  const invalidateRecords = useCallback(async () => {
    if (!spaceId || !activeProductionId) return;
    await queryClient.invalidateQueries({
      queryKey: ['spaces', spaceId, 'productions', activeProductionId, 'records'],
    });
  }, [activeProductionId, queryClient, spaceId]);

  const placeMutation = useMutation({
    mutationFn: async () => {
      if (!spaceId) throw new Error('Space is required');
      if (!activeProductionId) throw new Error('Production ID is required');
      if (!form.variantId) throw new Error('Variant is required');
      const timelineStartMs = parseNonNegativeInteger(form.timelineStartMs, 'Timeline start');
      const durationMs = form.durationMs.trim()
        ? parseNonNegativeInteger(form.durationMs, 'Duration')
        : undefined;
      const sceneLabel = form.sceneLabel.trim() || selectedOption?.asset.name || 'Scene';

      return apiFetch('POST /api/spaces/:id/production/placements', {
        params: { id: spaceId },
        json: {
          id: form.id || undefined,
          productionId: activeProductionId,
          variantId: form.variantId,
          shotId: form.shotId.trim() || undefined,
          sceneLabel,
          timelineStartMs,
          durationMs,
          motionPrompt: form.motionPrompt.trim() || undefined,
          sourceRefs: splitList(form.sourceRefs),
          sourceVariantIds: splitList(form.sourceVariantIds),
          metadata: {},
        },
      });
    },
    onSuccess: async () => {
      setForm(emptyForm);
      setFormError(null);
      await invalidateRecords();
    },
    onError: (error) => {
      if (error instanceof ApiFetchError) {
        setFormError(error.message);
        return;
      }
      setFormError(error instanceof Error ? error.message : 'Failed to save placement');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (recordId: string) => {
      if (!spaceId) throw new Error('Space is required');
      return apiFetch('DELETE /api/spaces/:id/production/records/:recordId', {
        params: { id: spaceId, recordId },
      });
    },
    onSuccess: invalidateRecords,
  });

  const handleFormChange = useCallback(<K extends keyof PlacementFormState>(
    key: K,
    value: PlacementFormState[K],
  ) => {
    setForm(current => ({ ...current, [key]: value }));
    setFormError(null);
  }, []);

  const handleVariantChange = useCallback((variantId: string) => {
    const option = variantOptions.find(item => item.variant.id === variantId);
    setForm(current => ({
      ...current,
      variantId,
      sceneLabel: current.sceneLabel || option?.asset.name || '',
    }));
    setFormError(null);
  }, [variantOptions]);

  const copyText = useCallback(async (label: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopyStatus(`${label} copied`);
    window.setTimeout(() => setCopyStatus(null), 1800);
  }, []);

  const headerRightSlot = user ? (
    <div className={styles.headerRight}>
      <HeaderNav userName={user.name} userEmail={user.email} />
    </div>
  ) : (
    <Link to="/login" className={styles.authButton}>Sign In</Link>
  );

  if (isLoadingSpace) {
    return (
      <div className={styles.page}>
        <WorkspaceChrome
          leftSlot={<Link to="/" className={styles.brand}>Make Effects</Link>}
          rightSlot={headerRightSlot}
          statusSlot={<UsageIndicator />}
        />
        <main className={styles.loading}>Loading production view...</main>
      </div>
    );
  }

  if (spaceError || !space || !spaceId) {
    return (
      <div className={styles.page}>
        <WorkspaceChrome
          leftSlot={<Link to="/" className={styles.brand}>Make Effects</Link>}
          rightSlot={headerRightSlot}
          statusSlot={<UsageIndicator />}
        />
        <main className={styles.errorState}>
          <h1>Production view unavailable</h1>
          <p>{spaceError || 'Space not found'}</p>
          <Link to="/" className={styles.secondaryLink}>Back to Spaces</Link>
        </main>
      </div>
    );
  }

  const handoffJson = handoff ? JSON.stringify(handoff, null, 2) : '';
  const sceneArgs = handoff ? formatRemotionSceneArgs(handoff) : '';

  return (
    <div className={styles.page}>
      <WorkspaceChrome
        leftSlot={<Link to="/" className={styles.brand}>Make Effects</Link>}
        centerSlot={
          <div className={styles.centerNav}>
            <Link to={`/spaces/${spaceId}`} className={styles.navLink}>Canvas</Link>
            <span className={styles.navCurrent}>Production</span>
          </div>
        }
        rightSlot={headerRightSlot}
        statusSlot={<UsageIndicator />}
      />

      <main className={styles.main}>
        <section className={styles.headerBand}>
          <div>
            <p className={styles.eyebrow}>{wsStatus === 'connected' ? 'Live space' : 'Space sync pending'}</p>
            <h1>{space.name}</h1>
          </div>
          <label className={styles.productionField}>
            <span>Production ID</span>
            <TextInput
              value={productionId}
              onChange={(event) => setProductionId(event.target.value)}
              placeholder="episode-01"
              fullWidth
            />
          </label>
        </section>

        <div className={styles.workspace}>
          <ProductionPlacementControls
            activeProductionId={activeProductionId}
            canEdit={canEdit}
            form={form}
            formError={formError}
            isSaving={placeMutation.isPending}
            onFormChange={handleFormChange}
            onNewPlacement={() => setForm(emptyForm)}
            onSubmit={() => placeMutation.mutate()}
            onVariantChange={handleVariantChange}
            selectedOption={selectedOption}
            spaceId={spaceId}
            variantOptions={variantOptions}
          />

          <section className={styles.recordsPanel}>
            <div className={styles.panelHeader}>
              <h2>Timeline Records</h2>
              <span className={styles.countBadge}>{sortedRecords.length}</span>
            </div>

            {!activeProductionId ? (
              <div className={styles.emptyState}>Enter a production ID to load placements.</div>
            ) : recordsQuery.isPending ? (
              <div className={styles.emptyState}>Loading placements...</div>
            ) : recordsQuery.error ? (
              <div className={styles.emptyState}>Failed to load production records.</div>
            ) : sortedRecords.length === 0 ? (
              <div className={styles.emptyState}>No placements saved for this production.</div>
            ) : (
              <div className={styles.recordList}>
                {sortedRecords.map((record) => {
                  const asset = assetById.get(record.asset_id);
                  const variant = variantById.get(record.variant_id) || null;
                  return (
                    <article key={record.id} className={styles.recordRow}>
                      <Thumbnail
                        variant={variant}
                        size="sm"
                        spaceId={spaceId}
                        showAudioControls
                        showVideoControls
                      />
                      <div className={styles.recordBody}>
                        <div className={styles.recordTopline}>
                          <strong>{record.scene_label}</strong>
                          <span>{formatTimelineOffset(record.timeline_start_ms)}</span>
                        </div>
                        <div className={styles.recordMeta}>
                          <span>{record.shot_id || 'No shot ID'}</span>
                          <span>{asset?.name || record.asset_id}</span>
                          <span>{formatMediaKind(record.media_kind)}</span>
                          <span>{formatDuration(record.duration_ms)}</span>
                        </div>
                        {record.motion_prompt && <p>{record.motion_prompt}</p>}
                      </div>
                      <div className={styles.recordActions}>
                        <IconButton
                          className={styles.recordIconButton}
                          onClick={() => setForm(recordToForm(record))}
                          aria-label="Edit placement"
                          title="Edit placement"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 20h9" />
                            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                          </svg>
                        </IconButton>
                        {canEdit && (
                          <IconButton
                            className={styles.recordIconButton}
                            onClick={() => deleteMutation.mutate(record.id)}
                            disabled={deleteMutation.isPending}
                            aria-label="Delete placement"
                            title="Delete placement"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6l-1 14H6L5 6" />
                              <path d="M10 11v6M14 11v6" />
                            </svg>
                          </IconButton>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <ProductionHandoffControls
            copyStatus={copyStatus}
            handoff={handoff}
            handoffJson={handoffJson}
            onCopyText={copyText}
            sceneArgs={sceneArgs}
            sortedRecords={sortedRecords}
          />
        </div>
      </main>
    </div>
  );
}
