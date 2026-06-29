import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

const baseTime = 1_700_000_000_000;
const imageSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#d9ddf7"/><path d="M20 68 42 42l14 16 10-12 12 22z" fill="#6f6ce8"/></svg>';

async function mockImages(page: Page) {
  await page.route('**/api/images/**', (route) => route.fulfill({
    status: 200,
    contentType: 'image/svg+xml',
    body: imageSvg,
  }));
}

async function resetScrollablePanels(page: Page) {
  await page.evaluate(() => {
    for (const element of Array.from(document.querySelectorAll('div'))) {
      if (element.scrollHeight > element.clientHeight) {
        element.scrollTop = 0;
      }
    }
  });
}

const sourceAsset = {
  id: 'hero',
  name: 'Hero Character',
  type: 'character',
  media_kind: 'image',
  tags: '',
  parent_asset_id: null,
  active_variant_id: 'hero-variant',
  created_by: 'user-1',
  created_at: baseTime,
  updated_at: baseTime,
};

const sourceVariant = {
  id: 'hero-variant',
  asset_id: sourceAsset.id,
  media_kind: 'image',
  workflow_id: null,
  status: 'completed',
  error_message: null,
  image_key: 'images/space/hero-variant.png',
  thumb_key: 'images/space/hero-variant-thumb.webp',
  media_key: 'images/space/hero-variant.png',
  media_mime_type: 'image/png',
  media_size_bytes: 123,
  media_width: 1024,
  media_height: 1024,
  media_duration_ms: null,
  recipe: '{}',
  starred: false,
  created_by: 'user-1',
  created_at: baseTime,
  updated_at: baseTime,
  description: null,
  quality_rating: null,
  rated_at: null,
};

test('tile set panel uses shared fields without changing submit payload', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 820 });
  await mountComponent(page, 'TileSetPanel', {
    tileSets: [],
    tilePositions: [],
    variants: [sourceVariant],
    hasDefaultStyle: true,
    onSubmit: '__record__:submitTileSet',
    onCancel: '__record__:cancelTileSet',
    onClose: '__record__:closeTileSet',
  });

  await expect(page.getByRole('heading', { name: 'Create Tile Set' })).toBeVisible();
  await page.getByPlaceholder('e.g. lush green forest floor with mossy stones and fallen leaves').fill('mossy forest floor');
  await page.getByLabel('No style').check();
  await resetScrollablePanels(page);
  await screenshot(page, 'tile-set-panel-shared-fields', { fullPage: true });

  await page.getByRole('button', { name: 'Generate 3x3 Tiles' }).click();

  const calls = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(calls).toContainEqual(expect.objectContaining({
    eventName: 'submitTileSet',
    args: [expect.objectContaining({
      tileType: 'terrain',
      gridWidth: 3,
      gridHeight: 3,
      prompt: 'mossy forest floor',
      disableStyle: true,
      generationMode: 'sequential',
    })],
  }));
});

test('rotation panel uses shared fields without changing submit payload', async ({ page }) => {
  await mockImages(page);
  await page.setViewportSize({ width: 900, height: 820 });
  await mountComponent(page, 'RotationPanel', {
    sourceVariant,
    sourceAsset,
    rotationSets: [],
    rotationViews: [],
    variants: [sourceVariant],
    hasDefaultStyle: true,
    onSubmit: '__record__:submitRotation',
    onCancel: '__record__:cancelRotation',
    onClose: '__record__:closeRotation',
  });

  await expect(page.getByRole('heading', { name: 'Generate Rotation Set' })).toBeVisible();
  await page.getByPlaceholder('e.g. a pixel art warrior character').fill('pixel art warrior');
  await page.getByLabel('No style').check();
  await resetScrollablePanels(page);
  await screenshot(page, 'rotation-panel-shared-fields', { fullPage: true });

  await page.getByRole('button', { name: 'Start Rotation' }).click();

  const calls = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(calls).toContainEqual(expect.objectContaining({
    eventName: 'submitRotation',
    args: [expect.objectContaining({
      sourceVariantId: 'hero-variant',
      config: '4-directional',
      subjectDescription: 'pixel art warrior',
      disableStyle: true,
      generationMode: 'sequential',
    })],
  }));
});
