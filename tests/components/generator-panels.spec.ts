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

async function selectOption(page: Page, label: string, optionName: string | RegExp) {
  await page.getByLabel(label).click();
  await page.getByRole('option', { name: optionName }).click();
}

async function expectTransparentBackdrop(page: Page) {
  const backdrop = page.locator('[class*="backdrop"]').first();
  await expect(backdrop).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(backdrop).toHaveCSS('backdrop-filter', 'none');
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
  await expectTransparentBackdrop(page);
  await selectOption(page, 'Tile Type', 'Building');
  await selectOption(page, 'Grid Size', '4x4');
  await selectOption(page, 'Generation Mode', 'Single-Shot');
  await page.getByPlaceholder('e.g. lush green forest floor with mossy stones and fallen leaves').fill('mossy forest floor');
  await page.getByLabel('No style').check();
  await resetScrollablePanels(page);
  await screenshot(page, 'tile-set-panel-shared-fields', { fullPage: true });

  await page.getByRole('button', { name: 'Generate 4x4 Tiles' }).click();

  const calls = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(calls).toContainEqual(expect.objectContaining({
    eventName: 'submitTileSet',
    args: [expect.objectContaining({
      tileType: 'building',
      gridWidth: 4,
      gridHeight: 4,
      prompt: 'mossy forest floor',
      disableStyle: true,
      generationMode: 'single-shot',
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
  await expectTransparentBackdrop(page);
  await selectOption(page, 'Configuration', /Turnaround/);
  await selectOption(page, 'Generation Mode', 'Single-Shot');
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
      config: 'turnaround',
      subjectDescription: 'pixel art warrior',
      disableStyle: true,
      generationMode: 'single-shot',
    })],
  }));
});

test('rotation panel keeps rating controls in footer chrome', async ({ page }) => {
  await mockImages(page);
  await page.setViewportSize({ width: 900, height: 820 });

  const completedRotationSet = {
    id: 'rotation-set-1',
    source_variant_id: sourceVariant.id,
    status: 'completed',
    config: JSON.stringify({ type: '4-directional' }),
    total_steps: 4,
    current_step: 4,
    error_message: null,
    created_at: baseTime,
    updated_at: baseTime,
  };
  const northVariant = { ...sourceVariant, id: 'rotation-north', quality_rating: 'approved' };
  const eastVariant = { ...sourceVariant, id: 'rotation-east', quality_rating: null };
  const southVariant = { ...sourceVariant, id: 'rotation-south', quality_rating: 'rejected' };
  const westVariant = { ...sourceVariant, id: 'rotation-west', quality_rating: null };
  const rotationViews = [
    { id: 'view-north', rotation_set_id: completedRotationSet.id, variant_id: northVariant.id, direction: 'North', step_index: 0, prompt: null, created_at: baseTime, updated_at: baseTime },
    { id: 'view-east', rotation_set_id: completedRotationSet.id, variant_id: eastVariant.id, direction: 'East', step_index: 1, prompt: null, created_at: baseTime, updated_at: baseTime },
    { id: 'view-south', rotation_set_id: completedRotationSet.id, variant_id: southVariant.id, direction: 'South', step_index: 2, prompt: null, created_at: baseTime, updated_at: baseTime },
    { id: 'view-west', rotation_set_id: completedRotationSet.id, variant_id: westVariant.id, direction: 'West', step_index: 3, prompt: null, created_at: baseTime, updated_at: baseTime },
  ];

  await mountComponent(page, 'RotationPanel', {
    sourceVariant,
    sourceAsset,
    rotationSets: [completedRotationSet],
    rotationViews,
    variants: [sourceVariant, northVariant, eastVariant, southVariant, westVariant],
    hasDefaultStyle: true,
    onSubmit: '__record__:submitRotation',
    onCancel: '__record__:cancelRotation',
    onClose: '__record__:closeRotation',
    onRateVariant: '__record__:rateRotation',
    onExportTrainingData: '__record__:exportRotation',
  });

  await expect(page.getByRole('heading', { name: 'Rotation Complete' })).toBeVisible();
  await expectTransparentBackdrop(page);
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Reject' })).toHaveAttribute('aria-pressed', 'false');

  const approvedDirection = page.getByRole('button', { name: /North/ });
  const approvedBorderColor = await approvedDirection.evaluate((element) => getComputedStyle(element).borderLeftColor);
  await approvedDirection.hover();
  await expect.poll(
    () => approvedDirection.evaluate((element) => getComputedStyle(element).borderLeftColor),
  ).toBe(approvedBorderColor);

  await page.getByRole('button', { name: /East/ }).click();
  await page.getByRole('button', { name: /East/ }).hover();
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Reject' })).toHaveCount(1);
  await expect(page.locator('[class*="ratingBadge"], [class*="ratingButtons"]')).toHaveCount(0);

  await resetScrollablePanels(page);
  await screenshot(page, 'rotation-panel-rating-chrome', { fullPage: true });

  await page.getByRole('button', { name: 'Reject' }).click();

  const calls = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(calls).toContainEqual(expect.objectContaining({
    eventName: 'rateRotation',
    args: ['rotation-east', 'rejected'],
  }));
});
