import { expect, test } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

const baseTime = 1_700_000_000_000;

function asset(id: string, name: string, type: string, mediaKind: 'image' | 'audio' | 'video' = 'image') {
  return {
    id,
    name,
    type,
    media_kind: mediaKind,
    tags: '',
    parent_asset_id: null,
    active_variant_id: `${id}-variant`,
    created_by: 'user-1',
    created_at: baseTime,
    updated_at: baseTime,
  };
}

function variant(assetId: string) {
  return {
    id: `${assetId}-variant`,
    asset_id: assetId,
    media_kind: 'image',
    workflow_id: null,
    status: 'completed',
    error_message: null,
    image_key: `images/space/${assetId}.png`,
    thumb_key: `images/space/${assetId}_thumb.webp`,
    media_key: `images/space/${assetId}.png`,
    media_mime_type: 'image/png',
    media_size_bytes: 123,
    media_width: 100,
    media_height: 100,
    media_duration_ms: null,
    transcript_key: null,
    transcript_mime_type: null,
    transcript_size_bytes: null,
    word_timings_key: null,
    word_timings_mime_type: null,
    word_timings_size_bytes: null,
    render_metadata_key: null,
    render_metadata_mime_type: null,
    render_metadata_size_bytes: null,
    recipe: '{}',
    starred: false,
    created_by: 'user-1',
    created_at: baseTime,
    updated_at: baseTime,
    description: null,
    quality_rating: null,
    rated_at: null,
  };
}

async function mockMedia(page: import('@playwright/test').Page) {
  await page.route('**/api/images/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#668cff"/></svg>',
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

test('asset picker uses shared search field and filters selectable assets', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 360 });
  await mockMedia(page);
  await mountComponent(page, 'AssetPicker', {
    assets: [
      asset('hero', 'Hero Character', 'character'),
      asset('forest', 'Forest Gate', 'environment'),
      asset('voice', 'Narrator Voice', 'speech', 'audio'),
    ],
    variants: [variant('hero'), variant('forest'), variant('voice')],
    selectedAssetId: 'forest',
    onSelect: '__record__:select-asset',
  });

  await expect(page.getByLabel('Search assets')).toBeVisible();
  const selectedOption = page.getByRole('button', { name: /Forest Gate/ });
  await expect(selectedOption).toBeVisible();
  await expect(selectedOption).toContainText('Selected');
  await expect(page.locator('[class*="checkmark"]')).toHaveCount(0);
  await expect(selectedOption).toHaveCSS(
    'background-color',
    await resolvedBackground(page, 'var(--color-status-processing-bg)'),
  );
  await selectedOption.hover();
  await expect(selectedOption).toHaveCSS('transform', 'none');
  const selectedThumbnail = selectedOption.locator('img').locator('xpath=..');
  await expect(selectedThumbnail).toHaveCSS('transform', 'none');
  await expect(selectedThumbnail).toHaveCSS('transition-property', 'border-color');
  await expect(selectedOption).toHaveCSS(
    'background-color',
    await resolvedBackground(page, 'var(--color-status-processing-bg)'),
  );
  await screenshot(page, 'asset-picker-selected-token-surface', { fullPage: true });

  await page.getByLabel('Search assets').fill('char');
  await expect(page.getByRole('button', { name: /Hero Character/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Forest Gate/ })).toHaveCount(0);

  await page.mouse.move(0, 0);
  await screenshot(page, 'asset-picker-shared-search', { fullPage: true });

  await page.getByRole('button', { name: /Hero Character/ }).click();
  const calls = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(calls).toEqual([
    { eventName: 'select-asset', args: ['hero'] },
  ]);
});
