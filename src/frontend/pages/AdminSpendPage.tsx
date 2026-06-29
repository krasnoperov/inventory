import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiFetchError } from '../../api/client';
import type { ProviderSpendSummaryResponse } from '../../api/types';
import { AppHeader } from '../components/AppHeader';
import { HeaderNav } from '../components/HeaderNav';
import { Link } from '../components/Link';
import { ErrorMessage } from '../components/forms';
import { useAuth } from '../contexts/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useNavigate } from '../hooks/useNavigate';
import { useSearchParams } from '../hooks/useSearchParams';
import { adminSpendQueryOptions, type AdminSpendFilters } from '../queries';
import { Button, ButtonLink, UiSelect, type SelectOption } from '../ui';
import styles from './AdminSpendPage.module.css';

type SpendAggregate = ProviderSpendSummaryResponse['totals'];
type SpendRow = SpendAggregate & Partial<Record<
  'provider' | 'providerModel' | 'mediaKind' | 'meterEventName' | 'spaceId' | 'assetId',
  string | null
>>;

const MEDIA_KINDS: Array<NonNullable<AdminSpendFilters['mediaKind']>> = ['image', 'audio', 'video'];
const MEDIA_KIND_OPTIONS: Array<SelectOption<string>> = [
  { value: '', label: 'All' },
  ...MEDIA_KINDS.map((kind) => ({ value: kind, label: kind[0].toUpperCase() + kind.slice(1) })),
];

function compactFilters(filters: AdminSpendFilters): AdminSpendFilters {
  return Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== undefined && value !== ''),
  ) as AdminSpendFilters;
}

function filtersFromSearch(searchParams: URLSearchParams): AdminSpendFilters {
  const mediaKind = searchParams.get('media_kind') ?? searchParams.get('mediaKind') ?? undefined;
  return compactFilters({
    from: searchParams.get('from') ?? undefined,
    to: searchParams.get('to') ?? undefined,
    userId: searchParams.get('user_id') ?? searchParams.get('userId') ?? undefined,
    spaceId: searchParams.get('space_id') ?? searchParams.get('spaceId') ?? undefined,
    provider: searchParams.get('provider') ?? undefined,
    mediaKind: MEDIA_KINDS.includes(mediaKind as NonNullable<AdminSpendFilters['mediaKind']>)
      ? mediaKind as NonNullable<AdminSpendFilters['mediaKind']>
      : undefined,
  });
}

function writeFiltersToSearch(filters: AdminSpendFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.userId) params.set('user_id', filters.userId);
  if (filters.spaceId) params.set('space_id', filters.spaceId);
  if (filters.provider) params.set('provider', filters.provider);
  if (filters.mediaKind) params.set('media_kind', filters.mediaKind);
  return params;
}

function formatUsd(amountMicroUsd: number): string {
  const amount = amountMicroUsd / 1_000_000;
  const isSubCent = amountMicroUsd > 0 && amountMicroUsd < 10_000;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: isSubCent ? 4 : 2,
    maximumFractionDigits: isSubCent ? 6 : 2,
  }).format(amount);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);
}

function formatPeriod(period: ProviderSpendSummaryResponse['period']): string {
  if (period.from && period.to) return `${period.from} to ${period.to}`;
  if (period.from) return `From ${period.from}`;
  if (period.to) return `Through ${period.to}`;
  return 'All time';
}

function spendErrorMessage(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof ApiFetchError && error.status === 403) {
    return 'Admin access required';
  }
  return error instanceof Error ? error.message : 'Failed to load provider cost analytics';
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <strong className={styles.statValue}>{value}</strong>
      {detail && <span className={styles.statDetail}>{detail}</span>}
    </div>
  );
}

function EmptyRows({ columns }: { columns: number }) {
  return (
    <tr>
      <td colSpan={columns} className={styles.emptyCell}>No provider cost rows</td>
    </tr>
  );
}

function SpendTable({
  title,
  rows,
  labelHeader,
  label,
  secondary,
}: {
  title: string;
  rows: SpendRow[];
  labelHeader: string;
  label: (row: SpendRow) => string;
  secondary?: (row: SpendRow) => string | null;
}) {
  return (
    <section className={styles.tableSection}>
      <div className={styles.sectionHeader}>
        <h2>{title}</h2>
        <span>{rows.length}</span>
      </div>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{labelHeader}</th>
              <th>Provider cost</th>
              <th>Quantity</th>
              <th>Entries</th>
              <th>Unpriced</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRows columns={5} />
            ) : rows.map((row, index) => (
              <tr key={`${title}-${label(row)}-${index}`}>
                <td>
                  <div className={styles.primaryCell}>{label(row)}</div>
                  {secondary?.(row) && <div className={styles.secondaryCell}>{secondary(row)}</div>}
                </td>
                <td>{formatUsd(row.amountMicroUsd)}</td>
                <td>{formatNumber(row.quantity)}</td>
                <td>{formatNumber(row.entries)}</td>
                <td>{formatNumber(row.unpricedEntries)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

interface AdminSpendViewProps {
  summary?: ProviderSpendSummaryResponse;
  draftFilters: AdminSpendFilters;
  isLoading?: boolean;
  error?: unknown;
  onDraftChange: (key: keyof AdminSpendFilters, value: string) => void;
  onApplyFilters: () => void;
  onClearFilters: () => void;
}

export function AdminSpendView({
  summary,
  draftFilters,
  isLoading = false,
  error = null,
  onDraftChange,
  onApplyFilters,
  onClearFilters,
}: AdminSpendViewProps) {
  const topSpaces = (summary?.bySpace ?? []).slice(0, 25);
  const topAssets = (summary?.byAsset ?? []).slice(0, 25);
  const topProviders = summary?.byProvider ?? [];
  const topModels = (summary?.byModel ?? []).slice(0, 25);

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <div className={styles.header}>
          <div>
            <p className={styles.kicker}>Admin</p>
            <h1>Provider Cost</h1>
          </div>
          <div className={styles.period}>{summary ? formatPeriod(summary.period) : isLoading ? 'Loading' : 'No data'}</div>
        </div>

        <form
          className={styles.filters}
          onSubmit={(event) => {
            event.preventDefault();
            onApplyFilters();
          }}
        >
          <label>
            <span>From</span>
            <input
              type="date"
              value={draftFilters.from ?? ''}
              onChange={(event) => onDraftChange('from', event.target.value)}
            />
          </label>
          <label>
            <span>To</span>
            <input
              type="date"
              value={draftFilters.to ?? ''}
              onChange={(event) => onDraftChange('to', event.target.value)}
            />
          </label>
          <label>
            <span>User ID</span>
            <input
              inputMode="numeric"
              value={draftFilters.userId ?? ''}
              onChange={(event) => onDraftChange('userId', event.target.value)}
            />
          </label>
          <label>
            <span>Space ID</span>
            <input
              value={draftFilters.spaceId ?? ''}
              onChange={(event) => onDraftChange('spaceId', event.target.value)}
            />
          </label>
          <label>
            <span>Provider</span>
            <input
              value={draftFilters.provider ?? ''}
              onChange={(event) => onDraftChange('provider', event.target.value)}
            />
          </label>
          <label>
            <span>Media</span>
            <UiSelect
              className={styles.mediaSelect}
              fullWidth
              label="Media"
              value={draftFilters.mediaKind ?? ''}
              options={MEDIA_KIND_OPTIONS}
              onValueChange={(value) => onDraftChange('mediaKind', value)}
            />
          </label>
          <div className={styles.filterActions}>
            <Button type="submit" className={styles.filterButton} variant="primary">Apply</Button>
            <Button type="button" className={styles.filterButton} onClick={() => onClearFilters()}>Reset</Button>
          </div>
        </form>

        <ErrorMessage message={spendErrorMessage(error)} />

        {summary && (
          <>
            <section className={styles.statsGrid}>
              <Stat
                label="Provider cost"
                value={formatUsd(summary.totals.amountMicroUsd)}
                detail={`${formatNumber(summary.totals.quantity)} units`}
              />
              <Stat
                label="Ledger entries"
                value={formatNumber(summary.totals.entries)}
                detail={`${formatNumber(summary.totals.unpricedEntries)} unpriced`}
              />
              <Stat
                label="Spaces"
                value={formatNumber(summary.bySpace.length)}
                detail={`${formatNumber(topSpaces.length)} shown`}
              />
              <Stat
                label="Assets"
                value={formatNumber(summary.byAsset.length)}
                detail={`${formatNumber(topAssets.length)} shown`}
              />
            </section>

            <div className={styles.tablesGrid}>
              <SpendTable
                title="Spaces"
                rows={topSpaces}
                labelHeader="Space"
                label={(row) => String(row.spaceId ?? 'No space')}
              />
              <SpendTable
                title="Assets"
                rows={topAssets}
                labelHeader="Asset"
                label={(row) => String(row.assetId ?? 'No asset')}
                secondary={(row) => row.spaceId ? `Space ${row.spaceId}` : null}
              />
              <SpendTable
                title="Providers"
                rows={topProviders}
                labelHeader="Provider"
                label={(row) => String(row.provider)}
              />
              <SpendTable
                title="Models"
                rows={topModels}
                labelHeader="Model"
                label={(row) => String(row.providerModel)}
                secondary={(row) => String(row.provider)}
              />
            </div>
          </>
        )}
      </div>
    </main>
  );
}

export default function AdminSpendPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => filtersFromSearch(searchParams), [searchParams]);
  const [draftFilters, setDraftFilters] = useState<AdminSpendFilters>(filters);
  const spendQuery = useQuery(adminSpendQueryOptions(filters));

  useDocumentTitle('Admin Provider Cost');

  useEffect(() => {
    if (!user) {
      navigate('/login');
    }
  }, [user, navigate]);

  useEffect(() => {
    setDraftFilters(filters);
  }, [filters]);

  const updateDraft = (key: keyof AdminSpendFilters, value: string) => {
    setDraftFilters((current) => compactFilters({
      ...current,
      [key]: value,
    }));
  };

  const applyFilters = () => {
    setSearchParams(writeFiltersToSearch(compactFilters(draftFilters)));
  };

  const resetFilters = () => {
    setDraftFilters({});
    setSearchParams(new URLSearchParams());
  };

  const headerRightSlot = user ? (
    <HeaderNav userName={user.name} userEmail={user.email} />
  ) : (
    <ButtonLink to="/login" className={styles.authButton} variant="primary">Sign In</ButtonLink>
  );

  return (
    <div className={styles.page}>
      <AppHeader
        leftSlot={(
          <Link to="/" className={styles.brand}>
            Make Effects
          </Link>
        )}
        rightSlot={headerRightSlot}
        isLoading={spendQuery.isFetching}
      />

      <AdminSpendView
        summary={spendQuery.data}
        draftFilters={draftFilters}
        isLoading={spendQuery.isFetching}
        error={spendQuery.error}
        onDraftChange={updateDraft}
        onApplyFilters={applyFilters}
        onClearFilters={resetFilters}
      />
    </div>
  );
}
