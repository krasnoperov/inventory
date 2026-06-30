import { expect, test } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

const baseTime = 1_700_000_000_000;

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

async function resolvedShadow(page: import('@playwright/test').Page, value: string) {
  return page.evaluate((shadowValue) => {
    const probe = document.createElement('div');
    probe.style.boxShadow = shadowValue;
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).boxShadow;
    probe.remove();
    return resolved;
  }, value);
}

async function mockImage(page: import('@playwright/test').Page) {
  const image = '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="#668cff"/><circle cx="80" cy="60" r="28" fill="#ffffff"/></svg>';
  await page.route('**/api/images/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: image,
    }),
  );
}

const completedImageVariant = {
  id: 'variant-image',
  asset_id: 'asset-1',
  media_kind: 'image',
  workflow_id: null,
  status: 'completed',
  error_message: null,
  image_key: 'images/space/variant-image.png',
  thumb_key: 'images/space/variant-image_thumb.webp',
  media_key: 'images/space/variant-image.png',
  media_mime_type: 'image/png',
  media_size_bytes: 123,
  media_width: 160,
  media_height: 120,
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

test('thumbnail starred state stays in surrounding chrome', async ({ page }) => {
  await mockImage(page);
  await page.setViewportSize({ width: 240, height: 220 });
  await mountComponent(page, 'Thumbnail', {
    size: 'md',
    showBadges: true,
    isActive: true,
    variant: {
      ...completedImageVariant,
      starred: true,
    },
  });

  const thumbnail = page.locator('[class*="thumbnail"]').first();
  await expect(thumbnail.locator('img')).toBeVisible();
  await expect(page.getByText('★')).toHaveCount(0);
  await expect(thumbnail.locator('[class*="starBadge"]')).toHaveCount(0);
  await expect(thumbnail).toHaveCSS(
    'box-shadow',
    await resolvedShadow(page, '-3px 0 0 var(--color-success), 0 0 0 2px var(--color-star-border)'),
  );
  await screenshot(page, 'thumbnail-starred-chrome', { fullPage: true });
});

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
  const retry = page.getByRole('button', { name: 'Retry' });
  await expect(retry).toBeVisible();
  await retry.hover();
  await expect(retry).toHaveCSS(
    'color',
    await resolvedColor(page, 'var(--button-primary-text)'),
  );
  await screenshot(page, 'thumbnail-shared-retry', { fullPage: true });

  await retry.click();
  await expect
    .poll(() => page.evaluate(() => window.__componentHarnessCalls ?? []))
    .toContain('retry');
});

test('thumbnail video preview uses tokenized backdrop and semantic contrast text', async ({ page }) => {
  await page.setViewportSize({ width: 240, height: 220 });
  await mountComponent(page, 'Thumbnail', {
    size: 'md',
    variant: {
      id: 'variant-video',
      asset_id: 'asset-1',
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
    },
  });

  const label = page.getByText('Video');
  await expect(label).toBeVisible();
  await expect(page.locator('[class*="thumbnail"]').first()).toHaveCSS(
    'transition-property',
    'border-color, box-shadow',
  );
  await expect(label.locator('xpath=ancestor::div[contains(@class, "videoPreview")]')).toHaveCSS(
    'background-color',
    await resolvedColor(page, 'var(--thumb-video-backdrop)'),
  );
  await expect(label).toHaveCSS(
    'color',
    await resolvedColor(page, 'var(--button-primary-text)'),
  );
  await expect(label).toHaveCSS('text-transform', 'none');
  await expect(label).toHaveCSS('letter-spacing', 'normal');
  await screenshot(page, 'thumbnail-video-token-contrast', { fullPage: true });
});
