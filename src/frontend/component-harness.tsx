import { StrictMode, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { AppHeader } from './components/AppHeader';
import { AssetCanvas } from './components/AssetCanvas';
import { AssetCard } from './components/AssetCard';
import { CollectionPlacementPicker } from './components/CollectionPlacementPicker';
import { CompositionDetail, CompositionUsageList } from './components/CompositionDetail';
import { CompositionPlacementControl } from './components/CompositionPlacementControl';
import { ForgeTray } from './components/ForgeTray';
import { Pagination } from './components/Pagination';
import { RelationEditorDialog, RelationsPanel } from './components/RelationsPanel';
import { SpaceBoard } from './components/SpaceBoard';
import { SpaceCanvas } from './components/SpaceCanvas';
import { SpaceSharingPanel } from './components/SpaceSharingPanel';
import { StyleReferenceUsagePanel } from './components/StyleReferenceUsagePanel';
import { VariantCanvas } from './components/VariantCanvas';
import { BillingPlanActions } from './components/BillingSection';
import { AdminSpendView } from './pages/AdminSpendPage';
import { AssetCollectionsPanel, AssetTypeSelect } from './pages/AssetDetailPage';
import { ProfileDangerZone, ProfileProviderKeyRow } from './pages/ProfilePage';
import { ProductionHandoffControls, ProductionPlacementControls } from './pages/ProductionPage';
import { SpaceAccessRequestView } from './pages/SpaceAccessRequestPage';
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
const AssetCollectionsPanelHarness = AssetCollectionsPanel as unknown as ComponentType<Record<string, unknown>>;
const ProfileProviderKeyRowHarness = ProfileProviderKeyRow as unknown as ComponentType<Record<string, unknown>>;
const ProfileDangerZoneHarness = ProfileDangerZone as unknown as ComponentType<Record<string, unknown>>;
const BillingPlanActionsHarness = BillingPlanActions as unknown as ComponentType<Record<string, unknown>>;

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
  AssetCanvas: AssetCanvas as unknown as ComponentType<Record<string, unknown>>,
  AssetCard: AssetCard as unknown as ComponentType<Record<string, unknown>>,
  AssetDetailControls: AssetDetailControlsHarness,
  CollectionPlacementPicker: CollectionPlacementPicker as unknown as ComponentType<Record<string, unknown>>,
  CompositionDetail: CompositionDetail as unknown as ComponentType<Record<string, unknown>>,
  CompositionUsageList: CompositionUsageList as unknown as ComponentType<Record<string, unknown>>,
  CompositionPlacementControl: CompositionPlacementControl as unknown as ComponentType<Record<string, unknown>>,
  ForgeTray: ForgeTray as unknown as ComponentType<Record<string, unknown>>,
  Pagination: Pagination as unknown as ComponentType<Record<string, unknown>>,
  ProfileBillingActions: ProfileBillingActionsHarness,
  ProductionControls: ProductionControlsHarness,
  RelationsPanel: RelationsPanel as unknown as ComponentType<Record<string, unknown>>,
  RelationEditorDialog: RelationEditorDialog as unknown as ComponentType<Record<string, unknown>>,
  SpaceBoard: SpaceBoard as unknown as ComponentType<Record<string, unknown>>,
  SpaceCanvas: SpaceCanvas as unknown as ComponentType<Record<string, unknown>>,
  SpaceSharingPanel: SpaceSharingPanel as unknown as ComponentType<Record<string, unknown>>,
  SpaceAccessRequestView: SpaceAccessRequestView as unknown as ComponentType<Record<string, unknown>>,
  StyleReferenceUsagePanel: StyleReferenceUsagePanel as unknown as ComponentType<Record<string, unknown>>,
  VariantCanvas: VariantCanvas as unknown as ComponentType<Record<string, unknown>>,
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
