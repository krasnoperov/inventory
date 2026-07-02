import { StrictMode, type ComponentProps, type ComponentType, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppHeader } from './components/AppHeader';
import { AudioPlayer } from './components/AudioPlayer/AudioPlayer';
import { AssetCard } from './components/AssetCard';
import { AssetMenu } from './components/AssetMenu';
import { AssetPicker } from './components/AssetPicker';
import { CanvasDropHint } from './components/CanvasDropHint';
import { CanvasToolbar, CanvasToolbarButton, CanvasToolbarDivider, CanvasToolbarLink, CanvasToolbarTitle } from './components/CanvasToolbar';
import { CreateSpaceDialog } from './components/CreateSpaceDialog';
import { ForgeTray } from './components/ForgeTray';
import { FormContainer, FormTitle } from './components/forms';
import { ImageLightbox } from './components/ImageLightbox';
import { Pagination } from './components/Pagination';
import { PublicNav } from './components/PublicNav';
import { PublicThemeToggle } from './components/PublicThemeToggle';
import { RotationPanel } from './components/RotationPanel/RotationPanel';
import { SpacesOverview } from './components/SpacesOverview';
import { SpaceCanvas } from './components/SpaceCanvas';
import { SpaceSharingPanel } from './components/SpaceSharingPanel';
import { Thumbnail } from './components/Thumbnail';
import { TileGrid } from './components/TileGrid/TileGrid';
import { TileSetPanel } from './components/TileSetPanel/TileSetPanel';
import { TopLoadingBar } from './components/TopLoadingBar';
import { UsageIndicatorView } from './components/UsageIndicator/UsageIndicator';
import { VariantCanvas } from './components/VariantCanvas';
import { VariantDetailsPanel } from './components/VariantCanvas/VariantDetailsPanel';
import { BillingPlanActions, UsageBar } from './components/BillingSection';
import { VoicePicker } from './components/ForgeTray/VoicePicker';
import { WorkspaceCanvas, WorkspaceChrome, WorkspaceLayout } from './components/WorkspaceChrome';
import { AuthContext, type AuthContextType } from './contexts/AuthContextProvider';
import { Button, ButtonLink, Checkbox, IconButton, SegmentedControl, TextArea, TextInput, UiSelect, type SelectOption } from './ui';
import type { MeterStatus } from './hooks/useBillingStatus';
import { AdminSpendView } from './pages/AdminSpendPage';
import { AuthorizationDecisionActions } from './pages/AuthorizationApprovalPage';
import { AssetDetailsContext, AssetDetailsStrip, AssetGenerationDock, AssetTitleInlineEditor, AssetTypeSelect } from './pages/AssetDetailPage';
import assetDetailStyles from './pages/AssetDetailPage.module.css';
import DocsPage from './pages/DocsPage';
import landingStyles from './pages/LandingPage.module.css';
import { GoogleLoginButton } from './pages/LoginPage';
import PricingPage from './pages/PricingPage';
import { ProfileDangerZone, ProfileProviderKeyRow } from './pages/ProfilePage';
import profileStyles from './pages/ProfilePage.module.css';
import { SpaceAccessRequestView } from './pages/SpaceAccessRequestPage';
import spacePageStyles from './pages/SpacePage.module.css';
import UnknownPage from './pages/UnknownPage';
import type {
  Asset,
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

const AssetTypeSelectHarness = AssetTypeSelect as unknown as ComponentType<Record<string, unknown>>;
const AssetTitleInlineEditorHarness = AssetTitleInlineEditor as unknown as ComponentType<Record<string, unknown>>;
const AssetGenerationDockHarness = AssetGenerationDock as unknown as ComponentType<Record<string, unknown>>;
const AssetDetailsContextHarness = AssetDetailsContext as unknown as ComponentType<Record<string, unknown>>;
const AssetDetailsStripHarness = AssetDetailsStrip as unknown as ComponentType<Record<string, unknown>>;
const ProfileProviderKeyRowHarness = ProfileProviderKeyRow as unknown as ComponentType<Record<string, unknown>>;
const ProfileDangerZoneHarness = ProfileDangerZone as unknown as ComponentType<Record<string, unknown>>;
const BillingPlanActionsHarness = BillingPlanActions as unknown as ComponentType<Record<string, unknown>>;
const docsAuthValue: AuthContextType = {
  user: null,
  loading: false,
  login: () => undefined,
  logout: async () => undefined,
  refreshUser: async () => undefined,
};

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
  { ...stackVariant('hero', 'hero-variant'), starred: true },
  stackVariant('atlas', 'atlas-variant'),
  stackVariant('map', 'map-variant'),
  stackVariant('scene', 'scene-variant'),
  stackVariant('output', 'output-variant'),
];

function AssetDetailControlsHarness(props: Record<string, unknown>) {
  return (
    <div style={{ display: 'grid', gap: '12px', maxWidth: '760px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <AssetTypeSelectHarness {...props} />
      </div>
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
        <CanvasToolbarButton active title="Canvas view" onClick={onAction}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="8" height="6" rx="1.5" />
            <rect x="14" y="4" width="7" height="9" rx="1.5" />
            <rect x="3" y="13" width="8" height="7" rx="1.5" />
            <rect x="14" y="16" width="7" height="4" rx="1.5" />
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

function AppHeaderPreview() {
  return (
    <AppHeader
      leftSlot={<strong>MakeFX</strong>}
      centerSlot={<span>Crystal Gate</span>}
      rightSlot={<Button variant="secondary" size="sm">Profile</Button>}
    />
  );
}

function WorkspaceChromePreview() {
  return (
    <WorkspaceChrome
      leftSlot={<strong>Space / Crystal Gate</strong>}
      centerSlot={<span>Assets</span>}
      statusSlot={<span style={{ color: 'var(--color-success)', fontSize: 'var(--font-size-small)' }}>Synced</span>}
      rightSlot={<Button variant="secondary" size="sm">Profile</Button>}
    />
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
    <div style={{ maxWidth: '520px', position: 'relative' }}>
      <AssetDetailsContextHarness {...props} />
    </div>
  );
}

function AssetGenerationDockPreview(props: Record<string, unknown>) {
  const {
    variantInspector: rawVariantInspector,
    showDockSummary,
    ...contextProps
  } = props;
  const variantInspector = rawVariantInspector as ReactNode | undefined;
  const renderDockSummary = showDockSummary !== false;
  const selectedVariant = stackVariants.find((variant) => variant.id === 'hero-variant') ?? null;
  const selectedVariantIndex = selectedVariant
    ? stackVariants.filter((variant) => variant.asset_id === 'hero').findIndex((variant) => variant.id === selectedVariant.id)
    : undefined;

  return (
    <WorkspaceLayout
      className={assetDetailStyles.canvasContainer}
      style={{ height: '100vh' }}
    >
      <WorkspaceCanvas className={assetDetailStyles.canvasStage} />
      <AssetGenerationDockHarness
        inspector={variantInspector}
        details={renderDockSummary ? (
          <AssetDetailsContextHarness
            {...contextProps}
            asset={stackAssets[0]}
            selectedVariant={selectedVariant}
            selectedVariantIndex={selectedVariantIndex}
            variantCount={stackVariants.filter((variant) => variant.asset_id === 'hero').length}
          />
        ) : undefined}
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
    </WorkspaceLayout>
  );
}

function AssetGenerationDockAudioNoEllipsisPreview() {
  const audioAsset: Asset = {
    ...stackAsset('audio-outro', 'Shorts outro - living room narration with a longer readable name', 'speech'),
    media_kind: 'audio',
    active_variant_id: 'audio-outro-variant',
  };
  const audioVariant: Variant = {
    ...stackVariant('audio-outro', 'audio-outro-variant'),
    media_kind: 'audio',
    image_key: null,
    thumb_key: null,
    media_key: 'audio/shorts-outro-living-room.wav',
    media_mime_type: 'audio/wav',
    media_width: null,
    media_height: null,
    media_duration_ms: 4800,
  };

  return (
    <AssetGenerationDockHarness
      details={(
        <AssetDetailsContextHarness
          asset={audioAsset}
          selectedVariant={audioVariant}
          selectedVariantIndex={0}
          variantCount={1}
        />
      )}
      tray={(
        <ForgeTray
          allAssets={[audioAsset]}
          allVariants={[audioVariant]}
          onSubmit={() => undefined}
          onBrandBackground={false}
          floating={false}
          currentAsset={audioAsset}
        />
      )}
    />
  );
}

function AssetGenerationDockClosedCanvasPreview() {
  return (
    <WorkspaceLayout className={assetDetailStyles.canvasContainer} style={{ height: '100vh' }}>
      <WorkspaceCanvas className={assetDetailStyles.canvasStage} />
      <AssetGenerationDockHarness
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
    </WorkspaceLayout>
  );
}

function AssetGenerationDockWithVariantInspectorPreview(props: Record<string, unknown>) {
  const selectedVariant = stackVariants.find((variant) => variant.id === 'hero-variant') ?? stackVariants[0];
  const selectedVariantIndex = stackVariants.filter((variant) => variant.asset_id === 'hero').findIndex((variant) => variant.id === selectedVariant.id);

  return (
    <AssetGenerationDockPreview
      {...props}
      showDockSummary={false}
      variantInspector={(
        <VariantDetailsPanel
          asset={stackAssets[0]}
          variant={selectedVariant}
          spaceId="space-1"
          avoidGenerationDock
          dockWithinCanvas
          isActive
          variantIndex={selectedVariantIndex}
          variantCount={2}
          lineage={[]}
          allVariants={stackVariants}
          allAssets={stackAssets}
          onClose={() => undefined}
          onStarVariant={() => undefined}
          onAddToTray={() => undefined}
        />
      )}
    />
  );
}

function AssetDetailOverlayChromePreview() {
  return (
    <div style={{ position: 'relative', width: '720px', height: '420px', padding: '1rem', background: 'var(--color-bg)' }}>
      <div className={assetDetailStyles.assetOverlay}>
        <CanvasToolbar ariaLabel="Scoped asset canvas controls" className={assetDetailStyles.detailToolbar}>
          <CanvasToolbarLink to="/spaces/space-1" title="Back to space">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5" />
              <path d="M12 19l-7-7 7-7" />
            </svg>
          </CanvasToolbarLink>
          <CanvasToolbarTitle className={assetDetailStyles.assetTitleSlot}>
            Crystal Gate with readable scoped title
          </CanvasToolbarTitle>
        </CanvasToolbar>
      </div>
      <section className={assetDetailStyles.tileGridOverlay} role="region" aria-label="Tile grid overlay">
        <div style={{ padding: '0.75rem', display: 'grid', gap: '0.35rem' }}>
          <strong>Tile grid</strong>
          <span>4x4 variant preview</span>
        </div>
      </section>
      <section className={assetDetailStyles.jobsOverlay} role="region" aria-label="Generation jobs">
        <div className={`${assetDetailStyles.jobCard} ${assetDetailStyles.processing}`}>
          <span className={assetDetailStyles.jobStatus} aria-label="Generating job" />
          <span className={assetDetailStyles.jobInfo}>
            <span className={assetDetailStyles.jobTitle}>Generating</span>
            <span className={assetDetailStyles.jobPrompt}>"clean asset detail chrome"</span>
          </span>
        </div>
      </section>
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

const billingPreviewMeters: MeterStatus[] = [
  {
    name: 'gemini_images',
    consumed: 320,
    credited: 1000,
    remaining: 680,
    percentUsed: 32,
    hasLimit: true,
    status: 'ok',
  },
  {
    name: 'gemini_videos',
    consumed: 760,
    credited: 1000,
    remaining: 240,
    percentUsed: 76,
    hasLimit: true,
    status: 'warning',
  },
  {
    name: 'gemini_audio',
    consumed: 930,
    credited: 1000,
    remaining: 70,
    percentUsed: 93,
    hasLimit: true,
    status: 'critical',
  },
  {
    name: 'elevenlabs_audio',
    consumed: 1200,
    credited: 1000,
    remaining: -200,
    percentUsed: 120,
    hasLimit: true,
    status: 'exceeded',
  },
];

function BillingUsageMetersPreview() {
  return (
    <div
      style={{
        width: 'min(720px, calc(100vw - 32px))',
        padding: '1.25rem',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-xl)',
        background: 'var(--color-surface)',
      }}
    >
      {billingPreviewMeters.map((meter) => (
        <UsageBar key={meter.status} meter={meter} />
      ))}
    </div>
  );
}

const selectPreviewOptions: Array<SelectOption<string>> = [
  { value: 'image', label: 'Image' },
  { value: 'video', label: 'Video' },
  { value: 'audio', label: 'Audio' },
];

function UiSelectPreview() {
  return (
    <div style={{ width: '260px', padding: '2rem' }}>
      <UiSelect
        value="video"
        options={selectPreviewOptions}
        onValueChange={() => undefined}
        label="Preview media type"
        fullWidth
      />
    </div>
  );
}

function UiButtonPreview() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', padding: '2rem' }}>
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="ghost" size="sm">Ghost small</Button>
      <Button variant="primary" disabled>Primary disabled</Button>
      <Button variant="secondary" disabled>Secondary disabled</Button>
      <IconButton variant="secondary" size="sm" aria-label="Preview icon action">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </IconButton>
    </div>
  );
}

function UiCheckboxPreview() {
  return (
    <div style={{ display: 'grid', gap: '0.75rem', padding: '2rem' }}>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
        <Checkbox defaultChecked aria-label="Checked preview" />
        <span>Checked</span>
      </label>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
        <Checkbox aria-label="Unchecked preview" />
        <span>Unchecked</span>
      </label>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', opacity: 0.72 }}>
        <Checkbox checked disabled readOnly aria-label="Disabled preview" />
        <span>Disabled</span>
      </label>
    </div>
  );
}

function UiTextFieldPreview() {
  return (
    <div style={{ display: 'grid', gap: '0.75rem', width: '320px', padding: '2rem' }}>
      <TextInput aria-label="Preview text input" defaultValue="Sprite name" fullWidth />
      <TextArea aria-label="Preview text area" defaultValue="A concise prompt for a clean game asset." fullWidth compact />
      <TextInput aria-label="Disabled text input" value="Disabled" disabled readOnly fullWidth />
    </div>
  );
}

function SegmentedControlPreview() {
  return (
    <div style={{ padding: '2rem' }}>
      <SegmentedControl
        label="Preview mode"
        value="story"
        options={[
          { value: 'story', label: 'Story' },
          { value: 'graph', label: 'Graph' },
          { value: 'raw', label: 'Raw' },
        ]}
        onValueChange={() => undefined}
      />
    </div>
  );
}

function LandingCreateSpaceDialogPreview(props: Record<string, unknown>) {
  return <CreateSpaceDialog {...(props as unknown as ComponentProps<typeof CreateSpaceDialog>)} surface="public" />;
}

function FormContainerPreview() {
  return (
    <div style={{ width: 'min(520px, 100%)', padding: '2rem' }}>
      <FormContainer maxWidth={440}>
        <FormTitle>Shared form</FormTitle>
        <TextInput aria-label="Project name" defaultValue="Market scene" fullWidth />
        <Button variant="primary">Continue</Button>
      </FormContainer>
    </div>
  );
}

function DashboardHoverChromePreview() {
  return (
    <div style={{ padding: '2rem', maxWidth: '680px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', marginBottom: '2rem' }}>
        <h1 style={{ margin: 0, fontSize: '2rem' }}>Spaces</h1>
        <ButtonLink to="/profile" variant="primary">Profile</ButtonLink>
      </div>
      <SpacesOverview
        spaces={[{ id: 'preview', name: 'Gameplay board', owner_id: 'user-1', role: 'owner', created_at: Date.UTC(2026, 5, 30) }]}
        isLoading={false}
        emptyDescription="Create your first space to start organizing your inventory."
        onCreateSpace={() => undefined}
      />
    </div>
  );
}

function DocsPagePreview(props: Record<string, unknown>) {
  return (
    <AuthContext.Provider value={docsAuthValue}>
      <DocsPage slug={typeof props.slug === 'string' ? props.slug : 'quickstart'} />
    </AuthContext.Provider>
  );
}

function PricingPagePreview() {
  return (
    <AuthContext.Provider value={docsAuthValue}>
      <PricingPage />
    </AuthContext.Provider>
  );
}

function PublicNavPreview() {
  return (
    <div className={landingStyles.page} style={{ colorScheme: 'dark', minHeight: 'auto', padding: '1.5rem' }}>
      <PublicNav
        links={[
          { to: '/pricing', label: 'Pricing' },
          { to: '/docs/quickstart', label: 'Docs' },
        ]}
        scheme="dark"
        onToggleScheme={() => undefined}
      />
    </div>
  );
}

function LandingCardHoverChromePreview() {
  return (
    <div className={landingStyles.page} style={{ colorScheme: 'dark' }}>
      <main style={{ width: 'min(960px, calc(100% - 2rem))', margin: '0 auto', padding: '3rem 0' }}>
        <section className={landingStyles.features}>
          <article className={landingStyles.featureItem}>
            <span className={landingStyles.featureIcon}>A</span>
            <h3 className={landingStyles.featureText}>Assets stay connected</h3>
            <p className={landingStyles.featureDescription}>Variants, prompts, and lineage stay readable without extra chrome.</p>
          </article>
          <article className={landingStyles.featureItem}>
            <span className={landingStyles.featureIcon}>B</span>
            <h3 className={landingStyles.featureText}>Review without clutter</h3>
            <p className={landingStyles.featureDescription}>Teams can scan media state and move into details intentionally.</p>
          </article>
        </section>
        <section style={{ marginTop: '1.5rem' }}>
          <SpacesOverview
            spaces={[{ id: 'preview', name: 'Market scene board', owner_id: 'user-1', role: 'owner', created_at: Date.UTC(2026, 5, 30) }]}
            isLoading={false}
            emptyDescription="Create your first space to start organizing assets."
            onCreateSpace={() => undefined}
          />
        </section>
      </main>
    </div>
  );
}

function SpacesOverviewPreview(props: Record<string, unknown>) {
  const empty = props.empty === true;
  return (
    <div style={{ width: 'min(760px, 100%)', padding: '2rem' }}>
      <SpacesOverview
        spaces={empty ? [] : [
          { id: 'market', name: 'Market scene board', owner_id: 'user-1', role: 'owner', created_at: Date.UTC(2026, 5, 30) },
          { id: 'encounter', name: 'Encounter props', owner_id: 'user-2', role: 'editor', created_at: Date.UTC(2026, 5, 29) },
        ]}
        isLoading={false}
        emptyDescription="Create your first space to start organizing assets."
        onCreateSpace={() => undefined}
      />
    </div>
  );
}

function LandingDualChromePreview() {
  return (
    <div className={landingStyles.page} style={{ colorScheme: 'dark' }}>
      <main style={{ width: 'min(900px, calc(100% - 2rem))', margin: '0 auto', padding: '3rem 0' }}>
        <div className={landingStyles.dual}>
          <div className={landingStyles.dualWeb}>
            <div className={landingStyles.dualBar}>
              <span className={landingStyles.dualBarDot} />
              <span className={landingStyles.dualBarDot} />
              <span className={landingStyles.dualBarLabel}>A person · the web app</span>
            </div>
            <div className={landingStyles.dualWebBody}>
              <div className={landingStyles.dualPath}>forest-tactics / Scout</div>
              <div className={landingStyles.variantRow}>
                <div className={`${landingStyles.variantCell} ${landingStyles.variantCellActive}`}>
                  <span className={landingStyles.variantStar} aria-hidden="true">★</span>
                </div>
                <div className={landingStyles.variantCell} />
                <div className={landingStyles.variantCell} />
              </div>
              <div className={landingStyles.dualActions}>
                <span className={landingStyles.dualBtnPrimary}>Keep v3</span>
                <span className={landingStyles.dualBtnGhost}>Hand off →</span>
              </div>
            </div>
          </div>
          <div className={landingStyles.dualSeam} aria-hidden="true">
            <span className={landingStyles.dualSeamPill}>space://forest-tactics</span>
          </div>
          <div className={landingStyles.dualShell}>
            <div className={landingStyles.dualShellBar}>
              <span className={landingStyles.dualShellDot} />
              <span className={landingStyles.dualShellLabel}>An agent · the shell</span>
            </div>
            <pre className={landingStyles.dualShellBody}>
              <span className={landingStyles.tPrompt}>agent$</span> makefx assets --space forest-tactics
              {'\n[\n  { "name": '}
              <span className={landingStyles.tOk}>&quot;Scout&quot;</span>
              {' }\n]'}
            </pre>
          </div>
        </div>
      </main>
    </div>
  );
}

function SpacePageOverlayChromePreview(props: Record<string, unknown>) {
  const showSharingRail = props.sidePanel === 'sharing';
  return (
    <div className={spacePageStyles.page}>
      <div className={spacePageStyles.canvasContainer}>
        <div className={`${spacePageStyles.canvasWorkspace} ${showSharingRail ? spacePageStyles.canvasWorkspaceWithInspector : ''}`}>
          <div className={spacePageStyles.canvasStage}>
            <CanvasToolbar ariaLabel="Space controls">
              <CanvasToolbarTitle>
                <h1 className={spacePageStyles.spaceTitle}>Cinematic Marketplace Space With Readable Asset Names</h1>
              </CanvasToolbarTitle>
            </CanvasToolbar>
            <div className={spacePageStyles.jobsOverlay}>
              <div className={`${spacePageStyles.jobCard} ${spacePageStyles.processing}`}>
                <span className={spacePageStyles.jobStatus} aria-label="Generating job" />
                <div className={spacePageStyles.jobInfo}>
                  <span className={spacePageStyles.jobAssetName}>Crystal Gate With Very Long Readable Generation Name</span>
                  <span className={spacePageStyles.jobPrompt}>"clean asset detail chrome without hiding important wording"</span>
                </div>
              </div>
              <div className={`${spacePageStyles.jobCard} ${spacePageStyles.completed}`}>
                <span className={spacePageStyles.jobStatus} aria-label="Done job" />
                <div className={spacePageStyles.jobInfo}>
                  <span className={spacePageStyles.jobAssetName}>Scout Variant Ready For Review With Long Name</span>
                </div>
              </div>
            </div>
          </div>

          {showSharingRail && (
            <div className={spacePageStyles.spaceSidePanelContainer}>
              <SpaceSharingPanel
                currentUserRole="owner"
                layout="rail"
                sharing={{
                  success: true,
                  members: [
                    {
                      user_id: 'user-owner',
                      role: 'owner',
                      joined_at: stackBaseTime,
                      user: { id: 'user-owner', email: 'owner@example.com', name: 'Owner With A Long Readable Name' },
                    },
                    {
                      user_id: 'user-editor',
                      role: 'editor',
                      joined_at: stackBaseTime,
                      user: { id: 'user-editor', email: 'long.editor.address@example.com', name: 'Collaborator With A Long Readable Asset Name' },
                    },
                  ],
                  pendingAccessRequests: [],
                  pendingInvitations: [],
                }}
                onClose={() => undefined}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CanvasDropHintPreview() {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
      gap: '1rem',
      width: 'min(840px, calc(100vw - 2rem))',
      padding: '1rem',
      background: 'var(--color-bg)',
    }}>
      <section
        aria-label="Space drop target preview"
        style={{
          position: 'relative',
          minHeight: '220px',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
          background: 'var(--color-bg)',
        }}
      >
        <CanvasDropHint
          scope="Space"
          message="New asset"
          detail="Drop a media file onto the canvas"
        />
      </section>
      <section
        aria-label="Details drop target preview"
        style={{
          position: 'relative',
          minHeight: '220px',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
          background: 'var(--color-bg)',
        }}
      >
        <CanvasDropHint
          scope="Details"
          message="New variant"
          detail="Crystal Gate"
        />
      </section>
    </div>
  );
}

function AppPrimaryActionChromePreview() {
  return (
    <div style={{ display: 'grid', gap: '0.75rem', padding: '2rem', width: '320px' }}>
      <ButtonLink to="/dashboard" variant="primary">Dashboard primary</ButtonLink>
      <ButtonLink to="/spaces/space-1" variant="primary" size="sm">Space primary</ButtonLink>
      <ButtonLink to="/spaces/space-1/assets/asset-1" variant="primary" size="sm">Details primary</ButtonLink>
      <ButtonLink to="/assets/asset-1" variant="primary" size="sm">Asset primary</ButtonLink>
    </div>
  );
}

function ProfileSignInButtonPreview() {
  return (
    <div className={profileStyles.page}>
      <AppHeader
        leftSlot={(
          <a href="/" className={profileStyles.brand}>
            Make Effects
          </a>
        )}
        rightSlot={<ButtonLink to="/login" variant="primary">Sign In</ButtonLink>}
      />
    </div>
  );
}

const registry: Record<string, ComponentType<Record<string, unknown>>> = {
  AppHeader: AppHeader as ComponentType<Record<string, unknown>>,
  AppHeaderPreview,
  AdminSpendView: AdminSpendView as unknown as ComponentType<Record<string, unknown>>,
  AudioPlayer: AudioPlayer as unknown as ComponentType<Record<string, unknown>>,
  AssetCard: AssetCard as unknown as ComponentType<Record<string, unknown>>,
  AssetMenu: AssetMenu as unknown as ComponentType<Record<string, unknown>>,
  AssetPicker: AssetPicker as unknown as ComponentType<Record<string, unknown>>,
  BillingUsageMeters: BillingUsageMetersPreview,
  CanvasDropHint: CanvasDropHintPreview,
  CanvasToolbarControls: CanvasToolbarControlsPreview,
  AuthorizationDecisionActions: AuthorizationDecisionActions as unknown as ComponentType<Record<string, unknown>>,
  AppPrimaryActionChrome: AppPrimaryActionChromePreview,
  AssetDetailControls: AssetDetailControlsHarness,
  AssetTitleInlineEditor: AssetTitleInlineEditorPreview,
  AssetGenerationDock: AssetGenerationDockPreview,
  AssetGenerationDockAudioNoEllipsis: AssetGenerationDockAudioNoEllipsisPreview,
  AssetGenerationDockClosedCanvas: AssetGenerationDockClosedCanvasPreview,
  AssetGenerationDockWithVariantInspector: AssetGenerationDockWithVariantInspectorPreview,
  AssetDetailOverlayChrome: AssetDetailOverlayChromePreview,
  AssetDetailsContext: AssetDetailsContextPreview,
  AssetDetailsStrip: AssetDetailsStripPreview,
  CreateSpaceDialog: CreateSpaceDialog as unknown as ComponentType<Record<string, unknown>>,
  DashboardHoverChrome: DashboardHoverChromePreview,
  DocsPage: DocsPagePreview,
  GoogleLoginButton: GoogleLoginButton as unknown as ComponentType<Record<string, unknown>>,
  LandingCreateSpaceDialog: LandingCreateSpaceDialogPreview,
  LandingCardHoverChrome: LandingCardHoverChromePreview,
  LandingDualChrome: LandingDualChromePreview,
  FormContainerPreview,
  ForgeTray: ForgeTray as unknown as ComponentType<Record<string, unknown>>,
  ImageLightbox: ImageLightbox as unknown as ComponentType<Record<string, unknown>>,
  Pagination: Pagination as unknown as ComponentType<Record<string, unknown>>,
  PricingPage: PricingPagePreview,
  ProfileBillingActions: ProfileBillingActionsHarness,
  ProfileSignInButton: ProfileSignInButtonPreview,
  PublicNav: PublicNavPreview,
  PublicThemeToggle: PublicThemeToggle as unknown as ComponentType<Record<string, unknown>>,
  SegmentedControl: SegmentedControlPreview,
  RotationPanel: RotationPanel as unknown as ComponentType<Record<string, unknown>>,
  SpaceCanvas: SpaceCanvas as unknown as ComponentType<Record<string, unknown>>,
  SpacePageOverlayChrome: SpacePageOverlayChromePreview,
  SpaceSharingPanel: SpaceSharingPanel as unknown as ComponentType<Record<string, unknown>>,
  SpaceAccessRequestView: SpaceAccessRequestView as unknown as ComponentType<Record<string, unknown>>,
  SpacesOverview: SpacesOverviewPreview,
  Thumbnail: Thumbnail as unknown as ComponentType<Record<string, unknown>>,
  TileGrid: TileGrid as unknown as ComponentType<Record<string, unknown>>,
  TileSetPanel: TileSetPanel as unknown as ComponentType<Record<string, unknown>>,
  TopLoadingBar: TopLoadingBar as unknown as ComponentType<Record<string, unknown>>,
  UnknownPage: UnknownPage as unknown as ComponentType<Record<string, unknown>>,
  UiButton: UiButtonPreview,
  UiCheckbox: UiCheckboxPreview,
  UiSelect: UiSelectPreview,
  UiTextField: UiTextFieldPreview,
  UsageIndicatorView: UsageIndicatorView as unknown as ComponentType<Record<string, unknown>>,
  VariantCanvas: VariantCanvas as unknown as ComponentType<Record<string, unknown>>,
  VariantDetailsPanel: VariantDetailsPanel as unknown as ComponentType<Record<string, unknown>>,
  VoicePicker: VoicePicker as unknown as ComponentType<Record<string, unknown>>,
  WorkspaceChromePreview,
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

  if (typeof value === 'string' && value.startsWith('__variantInForgeTray__:')) {
    const ids = new Set(value.slice('__variantInForgeTray__:'.length).split(',').filter(Boolean));
    return (variantId: string) => ids.has(variantId);
  }

  if (value instanceof Map) {
    return new Map(
      [...value.entries()].map(([key, entry]) => [key, revive(entry)]),
    );
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
