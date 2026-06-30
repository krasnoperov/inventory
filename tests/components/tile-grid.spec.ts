import { expect, test } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

const baseTime = 1_700_000_000_000;

const completedTileSet = {
  id: 'tile-set-1',
  asset_id: 'asset-1',
  tile_type: 'terrain',
  grid_width: 2,
  grid_height: 2,
  status: 'completed',
  seed_variant_id: null,
  config: '{}',
  current_step: 4,
  total_steps: 4,
  error_message: null,
  created_by: 'user-1',
  created_at: baseTime,
  updated_at: baseTime,
};

const failedTileSet = {
  ...completedTileSet,
  id: 'tile-set-failed',
  status: 'failed',
  error_message: 'Tile provider failed',
};

function variant(id: string, status = 'completed', qualityRating: 'approved' | 'rejected' | null = null) {
  return {
    id,
    asset_id: 'asset-1',
    media_kind: 'image',
    workflow_id: null,
    status,
    error_message: status === 'failed' ? 'provider failed' : null,
    image_key: status === 'completed' ? `images/space/${id}.png` : null,
    thumb_key: status === 'completed' ? `images/space/${id}_thumb.webp` : null,
    media_key: status === 'completed' ? `images/space/${id}.png` : null,
    media_mime_type: 'image/png',
    media_size_bytes: 123,
    media_width: 128,
    media_height: 128,
    media_duration_ms: null,
    recipe: '{}',
    starred: false,
    created_by: 'user-1',
    created_at: baseTime,
    updated_at: baseTime,
    description: null,
    quality_rating: qualityRating,
    rated_at: null,
  };
}

function tilePosition(tileSetId: string, variantId: string, gridX: number, gridY: number) {
  return {
    id: `${tileSetId}-${gridX}-${gridY}`,
    tile_set_id: tileSetId,
    variant_id: variantId,
    grid_x: gridX,
    grid_y: gridY,
    created_at: baseTime,
  };
}

async function mockMedia(page: import('@playwright/test').Page) {
  await page.route('**/api/images/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="#668cff"/><path d="M16 92 56 36l56 56z" fill="#ffffff"/></svg>',
    }),
  );
}

async function resolvedBackground(page: import('@playwright/test').Page, value: string) {
  return page.evaluate((backgroundValue) => {
    const probe = document.createElement('div');
    probe.style.background = backgroundValue;
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return resolved;
  }, value);
}

async function resolvedColor(page: import('@playwright/test').Page, value: string) {
  return page.evaluate((colorValue) => {
    const probe = document.createElement('div');
    probe.style.color = colorValue;
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return resolved;
  }, value);
}

test('tile grid actions use shared button styling', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 520 });
  await mockMedia(page);
  await mountComponent(page, 'TileGrid', {
    tileSet: completedTileSet,
    variants: [variant('tile-a', 'completed', 'approved'), variant('tile-b'), variant('tile-c'), variant('tile-d')],
    tilePositions: [
      tilePosition('tile-set-1', 'tile-a', 0, 0),
      tilePosition('tile-set-1', 'tile-b', 1, 0),
      tilePosition('tile-set-1', 'tile-c', 0, 1),
      tilePosition('tile-set-1', 'tile-d', 1, 1),
    ],
    selectedVariantId: 'tile-a',
    onCellClick: '__record__:cell',
    onRefineEdges: '__record__:refine',
    onExportTrainingData: '__record__:export',
    onRateVariant: '__record__:rate',
  });

  await expect(page.getByRole('button', { name: 'Refine Edges' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export Training Data' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Reject' })).toHaveAttribute('aria-pressed', 'false');
  await page.locator('[class*="cell"]').first().hover();
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Reject' })).toHaveCount(1);
  await screenshot(page, 'tile-grid-shared-actions', { fullPage: true });

  await page.getByRole('button', { name: 'Refine Edges' }).click();
  await page.getByRole('button', { name: 'Export Training Data' }).click();
  await page.getByRole('button', { name: 'Reject' }).click();
  const calls = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(calls.map((call) => call.eventName)).toEqual(['refine', 'export', 'rate']);
  expect(calls[2].args).toEqual(['tile-a', 'rejected']);
});

test('tile grid failed cell retry uses shared button styling', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 420 });
  await mountComponent(page, 'TileGrid', {
    tileSet: failedTileSet,
    variants: [variant('tile-failed', 'failed'), variant('tile-generating', 'processing')],
    tilePositions: [
      tilePosition('tile-set-failed', 'tile-failed', 0, 0),
      tilePosition('tile-set-failed', 'tile-generating', 1, 0),
    ],
    onRetryTile: '__record__:retry',
  });

  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  const generatingBadge = page.getByText('gen', { exact: true });
  const failedBadge = page.getByText('err', { exact: true });
  const failedCell = page.locator('[class*="cell"][class*="failed"]').first();
  const errorBanner = page.getByText('Tile provider failed');
  await expect(generatingBadge).toHaveCSS(
    'background-color',
    await resolvedBackground(page, 'var(--color-status-processing)'),
  );
  await expect(generatingBadge).toHaveCSS(
    'color',
    await resolvedColor(page, 'var(--button-primary-text)'),
  );
  await expect(failedBadge).toHaveCSS(
    'background-color',
    await resolvedBackground(page, 'var(--color-status-failed)'),
  );
  await expect(failedBadge).toHaveCSS(
    'color',
    await resolvedColor(page, 'var(--button-primary-text)'),
  );
  await expect(failedCell).toHaveCSS(
    'background-color',
    await resolvedBackground(page, 'var(--color-status-failed-bg)'),
  );
  await expect(errorBanner).toHaveCSS(
    'background-color',
    await resolvedBackground(page, 'var(--color-status-failed-bg)'),
  );
  await expect(errorBanner).toHaveCSS(
    'border-color',
    await resolvedColor(page, 'var(--color-error)'),
  );
  await screenshot(page, 'tile-grid-retry-action', { fullPage: true });

  await page.getByRole('button', { name: 'Retry' }).click();
  const calls = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({
    eventName: 'retry',
    args: ['tile-set-failed', 0, 0],
  });
});
