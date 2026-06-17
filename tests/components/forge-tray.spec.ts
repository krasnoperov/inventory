import { expect, test } from '@playwright/test';
import { MEDIA_OPERATION_MATRIX } from '../../src/shared/mediaOperationMatrix';
import { mountComponent, screenshot } from './harness';

const baseTime = 1_700_000_000_000;

function asset(id: string, name: string, type: string, mediaKind: 'image' | 'audio' | 'video') {
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

function variant(assetId: string, mediaKind: 'image' | 'audio' | 'video') {
  const isImage = mediaKind === 'image';
  return {
    id: `${assetId}-variant`,
    asset_id: assetId,
    media_kind: mediaKind,
    workflow_id: null,
    status: 'completed',
    error_message: null,
    image_key: isImage ? `images/space/${assetId}.png` : null,
    thumb_key: isImage ? `images/space/${assetId}_thumb.webp` : null,
    media_key: isImage ? `images/space/${assetId}.png` : `media/space/${assetId}.${mediaKind === 'audio' ? 'mp3' : 'mp4'}`,
    media_mime_type: mediaKind === 'audio' ? 'audio/mpeg' : mediaKind === 'video' ? 'video/mp4' : 'image/png',
    media_size_bytes: 123,
    media_width: mediaKind === 'audio' ? null : 100,
    media_height: mediaKind === 'audio' ? null : 100,
    media_duration_ms: mediaKind === 'image' ? null : 1200,
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

const matrixAssets = [
  asset('asset-image', 'Hero Image', 'character', 'image'),
  asset('asset-video', 'Hero Video', 'animation', 'video'),
  asset('asset-audio', 'Hero Speech', 'speech', 'audio'),
];

const matrixVariants = matrixAssets.map((entry) => variant(entry.id, entry.media_kind));

test('forge tray renders a screenshot matrix for every media mode', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 640 });

  await mountComponent(page, 'ForgeTray', {
    allAssets: [],
    allVariants: [],
    onSubmit: '__record__:forge-submit',
    onBrandBackground: false,
    sendStyleSet: '__noop__',
  });

  for (const config of MEDIA_OPERATION_MATRIX) {
    await page.getByTitle(`${config.label} mode`).click();

    await expect(page.getByTitle(`${config.label} mode`)).toHaveClass(/active/);
    await expect(page.getByPlaceholder(`Describe the ${config.promptNoun} to generate...`)).toBeVisible();
    await expect(page.getByPlaceholder(`${config.label} name`)).toBeVisible();

    const buttonLabel = config.mode === 'image' ? 'Generate' : `Generate ${config.shortLabel}`;
    await expect(page.getByRole('button', { name: buttonLabel })).toBeVisible();

    const batchSelector = page.locator('select[title="Number of variants to generate"]');
    const styleBadge = page.getByTitle('Configure style');

    if (config.supportsBatch) {
      await expect(batchSelector).toBeVisible();
    } else {
      await expect(batchSelector).toHaveCount(0);
    }

    if (config.supportsStyle) {
      await expect(styleBadge).toBeVisible();
    } else {
      await expect(styleBadge).toHaveCount(0);
    }

    await screenshot(page, `forge-tray-media-mode-${config.mode}`, { fullPage: true });
  }
});

test('forge tray picker disables references incompatible with the selected media mode', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 640 });

  await mountComponent(page, 'ForgeTray', {
    allAssets: matrixAssets,
    allVariants: matrixVariants,
    onSubmit: '__record__:forge-submit',
    onBrandBackground: false,
    sendStyleSet: '__noop__',
  });

  await page.getByTitle('Add reference').click();
  await expect(page.getByText('Image references')).toBeVisible();
  await expect(page.getByRole('button', { name: /Hero Image/ })).toBeEnabled();
  await expect(page.getByRole('button', { name: /Hero Video/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: /Hero Speech/ })).toBeDisabled();
  await page.getByRole('button', { name: /Close/i }).click();

  await page.getByTitle('Video mode').click();
  await page.getByTitle('Add reference').click();
  await expect(page.getByText('Video references')).toBeVisible();
  await expect(page.getByRole('button', { name: /Hero Image/ })).toBeEnabled();
  await expect(page.getByRole('button', { name: /Hero Video/ })).toBeEnabled();
  await expect(page.getByRole('button', { name: /Hero Speech/ })).toBeDisabled();
  await page.getByRole('button', { name: /Close/i }).click();

  await page.getByTitle('Speech mode').click();
  await page.getByTitle('Add reference').click();
  await expect(page.getByText('Speech references')).toBeVisible();
  await expect(page.getByRole('button', { name: /Hero Image/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: /Hero Video/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: /Hero Speech/ })).toBeEnabled();
});
