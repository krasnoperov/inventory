import { StrictMode, type ComponentProps, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { AppHeader } from './components/AppHeader';
import { AudioPlayer } from './components/AudioPlayer/AudioPlayer';
import { AssetCanvas } from './components/AssetCanvas';
import { AssetCard } from './components/AssetCard';
import { AssetMenu } from './components/AssetMenu';
import { AssetPicker } from './components/AssetPicker';
import { CollectionPlacementPicker } from './components/CollectionPlacementPicker';
import { CompositionDetail, CompositionUsageList } from './components/CompositionDetail';
import { CompositionPlacementControl } from './components/CompositionPlacementControl';
import { CanvasToolbar, CanvasToolbarButton, CanvasToolbarDivider, CanvasToolbarLink, CanvasToolbarTitle } from './components/CanvasToolbar';
import { ForgeTray } from './components/ForgeTray';
import { ImageLightbox } from './components/ImageLightbox';
import { LineageTree } from './components/LineageTree';
import { Pagination } from './components/Pagination';
import { PublicThemeToggle } from './components/PublicThemeToggle';
import { RelationEditorDialog, RelationsPanel } from './components/RelationsPanel';
import { RelationsCanvas } from './components/RelationsCanvas/RelationsCanvas';
import { RotationPanel } from './components/RotationPanel/RotationPanel';
import { SpaceBoard } from './components/SpaceBoard';
import { SpaceCanvas } from './components/SpaceCanvas';
import { SpaceSharingPanel } from './components/SpaceSharingPanel';
import { StyleReferenceUsagePanel } from './components/StyleReferenceUsagePanel';
import { Thumbnail } from './components/Thumbnail';
import { TileGrid } from './components/TileGrid/TileGrid';
import { TileSetPanel } from './components/TileSetPanel/TileSetPanel';
import { TopLoadingBar } from './components/TopLoadingBar';
import { UsageIndicatorView } from './components/UsageIndicator/UsageIndicator';
import { VariantCanvas } from './components/VariantCanvas';
import { VariantDetailsPanel } from './components/VariantCanvas/VariantDetailsPanel';
import { BillingPlanActions } from './components/BillingSection';
import { VoicePicker } from './components/ForgeTray/VoicePicker';
import { AdminSpendView } from './pages/AdminSpendPage';
import { AuthorizationDecisionActions } from './pages/AuthorizationApprovalPage';
import { AssetCollectionsPanel, AssetDetailsContext, AssetDetailsStrip, AssetGenerationDock, AssetTitleInlineEditor, AssetTypeSelect } from './pages/AssetDetailPage';
import { CreateSpaceDialog } from './pages/DashboardPage';
import { LandingCreateSpaceDialog } from './pages/LandingPage';
import { GoogleLoginButton } from './pages/LoginPage';
import { HyperbolicCanvas } from './components/HyperbolicCanvas/HyperbolicCanvas';
import { ProfileDangerZone, ProfileProviderKeyRow } from './pages/ProfilePage';
import { ProductionHandoffControls, ProductionPlacementControls } from './pages/ProductionPage';
import { SpaceAccessRequestView } from './pages/SpaceAccessRequestPage';
import UnknownPage from './pages/UnknownPage';
import type {
  Asset,
  CollectionItem,
  Composition,
  CompositionItem,
  Lineage,
  SpaceCollection,
  SpaceRelation,
  StylePresetRaw,
  Variant,
} from './space/protocol';
import './styles/theme.css';
import './styles/global.css';

declare global {
  interface Window {
    __componentHarnessCalls?: string[];
    __componentHarnessCallDetails?: Array<{ eventName: string; args: unknown[] }>;
    __setHarnessProps?: (props: Record<string, unknown>) => void;
  }
}

const ProductionPlacementHarness = ProductionPlacementControls as unknown as ComponentType<Record<string, unknown>>;
const ProductionHandoffHarness = ProductionHandoffControls as unknown as ComponentType<Record<string, unknown>>;
const AssetTypeSelectHarness = AssetTypeSelect as unknown as ComponentType<Record<string, unknown>>;
const AssetTitleInlineEditorHarness = AssetTitleInlineEditor as unknown as ComponentType<Record<string, unknown>>;
const AssetCollectionsPanelHarness = AssetCollectionsPanel as unknown as ComponentType<Record<string, unknown>>;
const AssetGenerationDockHarness = AssetGenerationDock as unknown as ComponentType<Record<string, unknown>>;
const AssetDetailsContextHarness = AssetDetailsContext as unknown as ComponentType<Record<string, unknown>>;
const AssetDetailsStripHarness = AssetDetailsStrip as unknown as ComponentType<Record<string, unknown>>;
const ProfileProviderKeyRowHarness = ProfileProviderKeyRow as unknown as ComponentType<Record<string, unknown>>;
const ProfileDangerZoneHarness = ProfileDangerZone as unknown as ComponentType<Record<string, unknown>>;
const BillingPlanActionsHarness = BillingPlanActions as unknown as ComponentType<Record<string, unknown>>;

const stackBaseTime = 1_700_000_000_000;

function stackAsset(id: string, name: string, type = 'character'): Asset {
  return {
    id,
    name,
    type,
    media_kind: 'image',
    tags: '',
    parent_asset_id: null,
    active_variant_id: `${id}-variant`,
    created_by: 'user-1',
    created_at: stackBaseTime,
    updated_at: stackBaseTime,
  };
}

function stackVariant(assetId: string, id = `${assetId}-variant`): Variant {
  return {
    id,
    asset_id: assetId,
    media_kind: 'image',
    workflow_id: null,
    status: 'completed',
    error_message: null,
    image_key: `images/space/${id}.png`,
    thumb_key: `images/space/${id}_thumb.webp`,
    media_key: `images/space/${id}.png`,
    media_mime_type: 'image/png',
    media_size_bytes: 123,
    media_width: 1024,
    media_height: 1024,
    media_duration_ms: null,
    recipe: '{}',
    starred: false,
    created_by: 'user-1',
    created_at: stackBaseTime,
    updated_at: stackBaseTime,
    description: null,
    quality_rating: null,
    rated_at: null,
  };
}

const stackAssets: Asset[] = [
  stackAsset('hero', 'Hero Character'),
  stackAsset('atlas', 'Atlas Sheet', 'sprite-sheet'),
  stackAsset('map', 'Map Source', 'reference'),
  stackAsset('scene', 'Scene Bar', 'scene'),
  stackAsset('output', 'Generated Output', 'scene'),
];

const stackVariants: Variant[] = [
  stackVariant('hero', 'hero-variant'),
  stackVariant('atlas', 'atlas-variant'),
  stackVariant('map', 'map-variant'),
  stackVariant('scene', 'scene-variant'),
  stackVariant('output', 'output-variant'),
];

const stackCollections: SpaceCollection[] = [
  {
    id: 'cast',
    name: 'Cast',
    kind: 'cast',
    color: null,
    description: null,
    sort_index: 0,
    item_count: 1,
    created_by: 'user-1',
    created_at: stackBaseTime,
    updated_at: stackBaseTime,
  },
  {
    id: 'style',
    name: 'Style refs',
    kind: 'style_refs',
    color: null,
    description: null,
    sort_index: 1,
    item_count: 1,
    created_by: 'user-1',
    created_at: stackBaseTime,
    updated_at: stackBaseTime,
  },
];

const stackCollectionItems: CollectionItem[] = [
  {
    id: 'cast-hero',
    collection_id: 'cast',
    subject_type: 'asset',
    asset_id: 'hero',
    variant_id: null,
    role: 'hero',
    pinned_variant_id: 'hero-variant',
    sort_index: 0,
    created_by: 'user-1',
    created_at: stackBaseTime,
    updated_at: stackBaseTime,
  },
  {
    id: 'style-hero',
    collection_id: 'style',
    subject_type: 'variant',
    asset_id: null,
    variant_id: 'hero-variant',
    role: 'style_ref',
    pinned_variant_id: null,
    sort_index: 1,
    created_by: 'user-1',
    created_at: stackBaseTime,
    updated_at: stackBaseTime,
  },
];

const stackStylePreset: StylePresetRaw = {
  id: 'preset-russafa',
  name: 'Russafa watercolor',
  description: null,
  style_prompt: 'Loose watercolor game concept art',
  collection_id: 'style',
  enabled: true,
  is_default: true,
  created_by: 'user-1',
  created_at: stackBaseTime,
  updated_at: stackBaseTime,
  collection_name: 'Style refs',
  reference_count: 1,
  style_reference_variant_ids: ['hero-variant'],
  style_reference_image_keys: ['images/space/hero-variant.png'],
};

const stackRelations: SpaceRelation[] = [
  {
    id: 'relation-out',
    subject_type: 'asset',
    subject_asset_id: 'hero',
    subject_variant_id: null,
    object_type: 'asset',
    object_asset_id: 'atlas',
    object_variant_id: null,
    relation_type: 'thumbnail_for',
    context: JSON.stringify({ label: 'Card art' }),
    sort_index: 0,
    created_by: 'user-1',
    created_at: stackBaseTime,
    updated_at: stackBaseTime,
  },
  {
    id: 'relation-in',
    subject_type: 'asset',
    subject_asset_id: 'map',
    subject_variant_id: null,
    object_type: 'variant',
    object_asset_id: null,
    object_variant_id: 'hero-variant',
    relation_type: 'map_for',
    context: JSON.stringify({ context: 'world map' }),
    sort_index: 1,
    created_by: 'user-1',
    created_at: stackBaseTime,
    updated_at: stackBaseTime,
  },
];

const stackLineage: Lineage[] = [
  {
    id: 'lineage-hero-atlas',
    parent_variant_id: 'hero-variant',
    child_variant_id: 'atlas-variant',
    relation_type: 'derived',
    severed: false,
    created_at: stackBaseTime,
  },
  {
    id: 'lineage-atlas-output',
    parent_variant_id: 'atlas-variant',
    child_variant_id: 'output-variant',
    relation_type: 'refined',
    severed: false,
    created_at: stackBaseTime + 1,
  },
];

const stackCompositions: Composition[] = [
  {
    id: 'composition-1',
    name: 'Scene Bar composition',
    description: null,
    status: 'draft',
    output_asset_id: 'output',
    output_variant_id: 'output-variant',
    metadata: '{}',
    sort_index: 0,
    created_by: 'user-1',
    created_at: stackBaseTime,
    updated_at: stackBaseTime,
  },
  {
    id: 'composition-2',
    name: 'Pinned variant scene',
    description: null,
    status: 'draft',
    output_asset_id: null,
    output_variant_id: null,
    metadata: '{}',
    sort_index: 1,
    created_by: 'user-1',
    created_at: stackBaseTime,
    updated_at: stackBaseTime,
  },
];

const stackCompositionItems: CompositionItem[] = [
  {
    id: 'composition-item-1',
    composition_id: 'composition-1',
    role: 'character',
    asset_id: 'hero',
    variant_id: 'hero-variant',
    metadata: '{}',
    sort_index: 0,
    created_by: 'user-1',
    created_at: stackBaseTime,
    updated_at: stackBaseTime,
  },
  {
    id: 'composition-item-2',
    composition_id: 'composition-2',
    role: 'thumbnail',
    asset_id: null,
    variant_id: 'hero-variant',
    metadata: '{}',
    sort_index: 0,
    created_by: 'user-1',
    created_at: stackBaseTime,
    updated_at: stackBaseTime,
  },
];

function ProductionControlsHarness(props: Record<string, unknown>) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 380px) minmax(320px, 1fr)', gap: '16px', alignItems: 'start' }}>
      <ProductionPlacementHarness {...props} />
      <ProductionHandoffHarness {...props} />
    </div>
  );
}

function AssetDetailControlsHarness(props: Record<string, unknown>) {
  return (
    <div style={{ display: 'grid', gap: '12px', maxWidth: '760px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <AssetTypeSelectHarness {...props} />
      </div>
      <AssetCollectionsPanelHarness {...props} />
    </div>
  );
}

function AssetTitleInlineEditorPreview(props: Record<string, unknown>) {
  return (
    <div style={{ position: 'relative', minHeight: '72px', padding: '12px' }}>
      <CanvasToolbar ariaLabel="Asset title preview">
        <CanvasToolbarTitle>
          <AssetTitleInlineEditorHarness {...props} />
        </CanvasToolbarTitle>
      </CanvasToolbar>
    </div>
  );
}

function CanvasToolbarControlsPreview(props: Record<string, unknown>) {
  const onAction = props.onAction as (() => void) | undefined;

  return (
    <div style={{ position: 'relative', minHeight: '72px', padding: '12px' }}>
      <CanvasToolbar ariaLabel="Toolbar preview">
        <CanvasToolbarTitle>Crystal Gate</CanvasToolbarTitle>
        <CanvasToolbarDivider />
        <CanvasToolbarButton title="Board view" onClick={onAction}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="8" height="6" rx="1.5" />
            <rect x="14" y="4" width="7" height="9" rx="1.5" />
            <rect x="3" y="13" width="8" height="7" rx="1.5" />
            <rect x="14" y="16" width="7" height="4" rx="1.5" />
          </svg>
        </CanvasToolbarButton>
        <CanvasToolbarButton active title="Relations view">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="5" cy="6" r="2.5" />
            <circle cx="19" cy="6" r="2.5" />
            <circle cx="12" cy="18" r="2.5" />
            <path d="M7 7.5 17 7.5M6.5 8 11 16M17.5 8 13 16" />
          </svg>
        </CanvasToolbarButton>
        <CanvasToolbarButton danger title="Delete asset">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 6h18" />
            <path d="M8 6V4h8v2" />
            <path d="M19 6l-1 14H6L5 6" />
          </svg>
        </CanvasToolbarButton>
        <CanvasToolbarLink to="/spaces/space-1" title="Back to space">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </CanvasToolbarLink>
      </CanvasToolbar>
    </div>
  );
}

function AssetDetailsStripPreview(props: Record<string, unknown>) {
  return (
    <div style={{ maxWidth: '520px' }}>
      <AssetDetailsStripHarness {...props} />
    </div>
  );
}

function AssetDetailsContextPreview(props: Record<string, unknown>) {
  return (
    <div style={{ maxWidth: '520px' }}>
      <AssetDetailsContextHarness {...props}>
        <section aria-label="Expanded asset details" style={{ display: 'grid', gap: 8 }}>
          <div style={{ padding: 8, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)' }}>
            Asset collections
          </div>
          <div style={{ padding: 8, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)' }}>
            Relations
          </div>
        </section>
      </AssetDetailsContextHarness>
    </div>
  );
}

function AssetGenerationDockPreview(props: Record<string, unknown>) {
  const selectedVariant = stackVariants.find((variant) => variant.id === 'hero-variant') ?? null;

  return (
    <AssetGenerationDockHarness
      details={(
        <AssetDetailsContextHarness
          {...props}
          asset={stackAssets[0]}
          assetCollectionCount={1}
          fullDetailsOpen
          selectedVariant={selectedVariant}
          selectedVariantCollectionCount={1}
          variantCount={stackVariants.filter((variant) => variant.asset_id === 'hero').length}
        >
          <AssetCollectionsPanel
            assetPlacementDrafts={[]}
            collections={stackCollections}
            collectionItems={stackCollectionItems}
            onApplyAssetPlacements={() => undefined}
            onApplyVariantPlacements={() => undefined}
            onAssetPlacementDraftsChange={() => undefined}
            onDeleteCollectionItem={() => undefined}
            onUpdateCollectionItem={() => undefined}
            onVariantPlacementDraftsChange={() => undefined}
            selectedVariant={selectedVariant}
            variantPlacementDrafts={[]}
            variants={stackVariants}
          />
          <StyleReferenceUsagePanel
            spaceId="space-1"
            collections={[stackCollections[1]]}
            presets={[stackStylePreset]}
            outputs={[stackAssets[4]]}
          />
          <RelationsPanel
            assets={stackAssets}
            variants={stackVariants}
            relations={stackRelations}
            subjects={[
              { subjectType: 'asset', assetId: 'hero' },
              { subjectType: 'variant', variantId: 'hero-variant' },
            ]}
            primarySubject={{ subjectType: 'asset', assetId: 'hero' }}
            onCreate={() => undefined}
            onEdit={() => undefined}
            onDelete={() => undefined}
          />
          <CompositionUsageList
            targetAssetId="hero"
            assets={stackAssets}
            variants={stackVariants}
            compositions={stackCompositions}
            compositionItems={stackCompositionItems}
            onOpenComposition={() => undefined}
          />
        </AssetDetailsContextHarness>
      )}
      tray={(
        <ForgeTray
          allAssets={stackAssets}
          allVariants={stackVariants}
          onSubmit={() => undefined}
          onBrandBackground={false}
          floating={false}
        />
      )}
    />
  );
}

function RelationsCanvasPreview(props: Record<string, unknown>) {
  return (
    <div style={{ position: 'relative', width: '900px', height: '640px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
      <RelationsCanvas
        {...props}
        spaceId="space-1"
        assets={stackAssets}
        variants={stackVariants}
        lineage={stackLineage}
        relations={stackRelations}
        collections={stackCollections}
        collectionItems={stackCollectionItems}
        compositions={stackCompositions}
        compositionItems={stackCompositionItems}
        onAssetClick={(props.onAssetClick as ((asset: Asset) => void) | undefined) ?? (() => undefined)}
      />
    </div>
  );
}

const lineagePreviewCurrent = {
  id: 'hero-variant',
  asset_id: 'hero',
  image_key: 'images/space/hero-variant.png',
  thumb_key: 'images/space/hero-variant_thumb.webp',
};

function LineageTreePreview(props: Record<string, unknown>) {
  const overrides = props as Partial<ComponentProps<typeof LineageTree>>;
  const defaults: ComponentProps<typeof LineageTree> = {
    currentVariant: lineagePreviewCurrent,
    parents: [
      {
        variant: {
          id: 'map-variant',
          asset_id: 'map',
          image_key: 'images/space/map-variant.png',
          thumb_key: 'images/space/map-variant_thumb.webp',
        },
        relation_type: 'derived',
        lineage_id: 'lineage-map-hero',
      },
    ],
    children: [
      {
        variant: {
          id: 'atlas-variant',
          asset_id: 'atlas',
          image_key: 'images/space/atlas-variant.png',
          thumb_key: 'images/space/atlas-variant_thumb.webp',
        },
        relation_type: 'refined',
        lineage_id: 'lineage-hero-atlas',
      },
      {
        variant: {
          id: 'output-variant',
          asset_id: 'output',
          image_key: 'images/space/output-variant.png',
          thumb_key: 'images/space/output-variant_thumb.webp',
        },
        relation_type: 'forked',
        severed: true,
        lineage_id: 'lineage-hero-output',
      },
    ],
    onSelectVariant: () => undefined,
    onSeverLineage: () => undefined,
    spaceId: 'space-1',
  };

  return (
    <div style={{ maxWidth: '520px' }}>
      <LineageTree {...defaults} {...overrides} />
    </div>
  );
}

function ProfileBillingActionsHarness(props: Record<string, unknown>) {
  return (
    <div style={{ display: 'grid', gap: '16px', maxWidth: '640px' }}>
      <ProfileProviderKeyRowHarness {...props} />
      <BillingPlanActionsHarness {...props} />
      <ProfileDangerZoneHarness {...props} />
    </div>
  );
}

const registry: Record<string, ComponentType<Record<string, unknown>>> = {
  AppHeader: AppHeader as ComponentType<Record<string, unknown>>,
  AdminSpendView: AdminSpendView as unknown as ComponentType<Record<string, unknown>>,
  AudioPlayer: AudioPlayer as unknown as ComponentType<Record<string, unknown>>,
  AssetCanvas: AssetCanvas as unknown as ComponentType<Record<string, unknown>>,
  AssetCard: AssetCard as unknown as ComponentType<Record<string, unknown>>,
  AssetMenu: AssetMenu as unknown as ComponentType<Record<string, unknown>>,
  AssetPicker: AssetPicker as unknown as ComponentType<Record<string, unknown>>,
  CanvasToolbarControls: CanvasToolbarControlsPreview,
  AuthorizationDecisionActions: AuthorizationDecisionActions as unknown as ComponentType<Record<string, unknown>>,
  AssetDetailControls: AssetDetailControlsHarness,
  AssetTitleInlineEditor: AssetTitleInlineEditorPreview,
  AssetGenerationDock: AssetGenerationDockPreview,
  AssetDetailsContext: AssetDetailsContextPreview,
  AssetDetailsStrip: AssetDetailsStripPreview,
  CollectionPlacementPicker: CollectionPlacementPicker as unknown as ComponentType<Record<string, unknown>>,
  CompositionDetail: CompositionDetail as unknown as ComponentType<Record<string, unknown>>,
  CompositionUsageList: CompositionUsageList as unknown as ComponentType<Record<string, unknown>>,
  CompositionPlacementControl: CompositionPlacementControl as unknown as ComponentType<Record<string, unknown>>,
  CreateSpaceDialog: CreateSpaceDialog as unknown as ComponentType<Record<string, unknown>>,
  GoogleLoginButton: GoogleLoginButton as unknown as ComponentType<Record<string, unknown>>,
  HyperbolicCanvas: HyperbolicCanvas as unknown as ComponentType<Record<string, unknown>>,
  LandingCreateSpaceDialog: LandingCreateSpaceDialog as unknown as ComponentType<Record<string, unknown>>,
  ForgeTray: ForgeTray as unknown as ComponentType<Record<string, unknown>>,
  ImageLightbox: ImageLightbox as unknown as ComponentType<Record<string, unknown>>,
  LineageTree: LineageTreePreview,
  Pagination: Pagination as unknown as ComponentType<Record<string, unknown>>,
  ProfileBillingActions: ProfileBillingActionsHarness,
  PublicThemeToggle: PublicThemeToggle as unknown as ComponentType<Record<string, unknown>>,
  ProductionControls: ProductionControlsHarness,
  RelationsPanel: RelationsPanel as unknown as ComponentType<Record<string, unknown>>,
  RelationEditorDialog: RelationEditorDialog as unknown as ComponentType<Record<string, unknown>>,
  RelationsCanvas: RelationsCanvasPreview,
  RotationPanel: RotationPanel as unknown as ComponentType<Record<string, unknown>>,
  SpaceBoard: SpaceBoard as unknown as ComponentType<Record<string, unknown>>,
  SpaceCanvas: SpaceCanvas as unknown as ComponentType<Record<string, unknown>>,
  SpaceSharingPanel: SpaceSharingPanel as unknown as ComponentType<Record<string, unknown>>,
  SpaceAccessRequestView: SpaceAccessRequestView as unknown as ComponentType<Record<string, unknown>>,
  StyleReferenceUsagePanel: StyleReferenceUsagePanel as unknown as ComponentType<Record<string, unknown>>,
  Thumbnail: Thumbnail as unknown as ComponentType<Record<string, unknown>>,
  TileGrid: TileGrid as unknown as ComponentType<Record<string, unknown>>,
  TileSetPanel: TileSetPanel as unknown as ComponentType<Record<string, unknown>>,
  TopLoadingBar: TopLoadingBar as unknown as ComponentType<Record<string, unknown>>,
  UnknownPage: UnknownPage as unknown as ComponentType<Record<string, unknown>>,
  UsageIndicatorView: UsageIndicatorView as unknown as ComponentType<Record<string, unknown>>,
  VariantCanvas: VariantCanvas as unknown as ComponentType<Record<string, unknown>>,
  VariantDetailsPanel: VariantDetailsPanel as unknown as ComponentType<Record<string, unknown>>,
  VoicePicker: VoicePicker as unknown as ComponentType<Record<string, unknown>>,
};

function revive(value: unknown): unknown {
  if (value === '__noop__') {
    return () => {};
  }

  if (typeof value === 'string' && value.startsWith('__record__:')) {
    const eventName = value.slice('__record__:'.length);
    return (...args: unknown[]) => {
      const calls = [...(window.__componentHarnessCalls ?? []), eventName];
      if (args.length > 0) {
        calls.push(`${eventName}:${JSON.stringify(args)}`);
      }
      window.__componentHarnessCalls = calls;
      window.__componentHarnessCallDetails = [...(window.__componentHarnessCallDetails ?? []), { eventName, args }];
    };
  }

  if (Array.isArray(value)) {
    return value.map(revive);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, revive(entry)]),
    );
  }

  return value;
}

function readProps(searchParams: URLSearchParams): Record<string, unknown> {
  const encoded = searchParams.get('props');
  if (!encoded) {
    return {};
  }

  const json = atob(decodeURIComponent(encoded));
  return revive(JSON.parse(json)) as Record<string, unknown>;
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Missing #root element');
}

const root = createRoot(rootElement);
const searchParams = new URLSearchParams(window.location.search);
const componentName = searchParams.get('component') ?? '';
const Component = registry[componentName];

if (!Component) {
  throw new Error(`Unknown component: ${componentName}`);
}

function render(props: Record<string, unknown>) {
  root.render(
    <StrictMode>
      <div data-testid="harness-root">
        <Component {...props} />
      </div>
    </StrictMode>,
  );
}

window.__componentHarnessCalls = [];
window.__componentHarnessCallDetails = [];
window.__setHarnessProps = (props) => render(revive(props) as Record<string, unknown>);

render(readProps(searchParams));
