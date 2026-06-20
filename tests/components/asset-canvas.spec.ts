import { expect, test } from '@playwright/test';
import { mountComponent } from './harness';

const baseTime = 1_700_000_000_000;

const videoAsset = {
  id: 'asset-video',
  name: 'Motion Promo',
  type: 'animation',
  media_kind: 'video',
  tags: '',
  parent_asset_id: null,
  active_variant_id: 'variant-video',
  created_by: 'user-1',
  created_at: baseTime,
  updated_at: baseTime,
};

const videoVariant = {
  id: 'variant-video',
  asset_id: videoAsset.id,
  media_kind: 'video',
  workflow_id: null,
  status: 'completed',
  error_message: null,
  image_key: null,
  thumb_key: null,
  media_key: 'media/space/variant-video.mp4',
  media_mime_type: 'video/mp4',
  media_size_bytes: 123,
  media_width: 1920,
  media_height: 1080,
  media_duration_ms: 6000,
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

test('asset canvas video cards remain navigable from preview and caption', async ({ page }) => {
  await mountComponent(page, 'AssetCanvas', {
    spaceId: 'space-1',
    assets: [videoAsset],
    variants: [videoVariant],
    isInitialSyncPending: false,
    onAssetClick: '__record__:asset-click',
  });

  await page.locator('[data-testid="harness-root"]').evaluate((element) => {
    const root = element as HTMLElement;
    root.style.width = '1000px';
    root.style.height = '700px';
  });

  await expect(page.getByText('Motion Promo')).toBeVisible();
  await expect(page.locator('video')).toHaveCount(0);

  await page.locator('[class*="videoLabel"]').click();
  await expect
    .poll(() => page.evaluate(() => window.__componentHarnessCalls ?? []))
    .toContain('asset-click');

  await page.evaluate(() => {
    window.__componentHarnessCalls = [];
    window.__componentHarnessCallDetails = [];
  });

  await page.getByText('Motion Promo').click();
  await expect
    .poll(() => page.evaluate(() => window.__componentHarnessCalls ?? []))
    .toContain('asset-click');
});
