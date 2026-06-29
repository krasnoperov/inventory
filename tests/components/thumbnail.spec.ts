import { expect, test } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

const baseTime = 1_700_000_000_000;

test('thumbnail failed retry action uses shared button styling', async ({ page }) => {
  await page.setViewportSize({ width: 240, height: 220 });
  await mountComponent(page, 'Thumbnail', {
    size: 'md',
    variant: {
      id: 'variant-failed',
      asset_id: 'asset-1',
      media_kind: 'image',
      workflow_id: 'workflow-1',
      status: 'failed',
      error_message: 'Provider failed',
      image_key: null,
      thumb_key: null,
      media_key: null,
      media_mime_type: null,
      media_size_bytes: null,
      media_width: null,
      media_height: null,
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
    },
    onRetry: '__record__:retry',
  });

  await expect(page.getByText('Failed')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  await screenshot(page, 'thumbnail-shared-retry', { fullPage: true });

  await page.getByRole('button', { name: 'Retry' }).click();
  await expect
    .poll(() => page.evaluate(() => window.__componentHarnessCalls ?? []))
    .toContain('retry');
});
