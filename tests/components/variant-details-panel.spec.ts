import { expect, test } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

const baseTime = 1_700_000_000_000;

const asset = {
  id: 'asset-1',
  name: 'Crystal Gate',
  type: 'prop',
  media_kind: 'image',
  tags: '',
  parent_asset_id: null,
  active_variant_id: 'variant-1',
  created_by: 'user-1',
  created_at: baseTime,
  updated_at: baseTime,
};

const variant = {
  id: 'variant-1',
  asset_id: asset.id,
  media_kind: 'image',
  workflow_id: null,
  status: 'completed',
  error_message: null,
  image_key: 'images/space/variant-1.png',
  thumb_key: 'images/space/variant-1_thumb.webp',
  media_key: 'images/space/variant-1.png',
  media_mime_type: 'image/png',
  media_size_bytes: 2048,
  media_width: 1024,
  media_height: 1024,
  media_duration_ms: null,
  generation_provenance: JSON.stringify({ operation: 'generate', assetType: 'prop', modelProvider: 'openai' }),
  provider_metadata: JSON.stringify({ provider: 'openai', model: 'image-model' }),
  recipe: JSON.stringify({ prompt: 'A blue crystal gate for a tactics game.', model: 'image-model' }),
  starred: false,
  created_by: 'user-1',
  created_at: baseTime,
  updated_at: baseTime,
  description: 'A polished blue portal gate.',
  quality_rating: null,
  rated_at: null,
};

test('variant details panel uses shared action controls', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 720 });
  await mountComponent(page, 'VariantDetailsPanel', {
    asset,
    variant,
    spaceId: 'space-1',
    isActive: false,
    variantCount: 2,
    lineage: [],
    allVariants: [variant],
    allAssets: [asset],
    onClose: '__record__:close',
    onStarVariant: '__record__:star',
    onDeleteVariant: '__record__:delete',
    onCreateRelation: '__record__:relation',
    onAddVariantToCollection: '__record__:collection',
    onAddToTray: '__record__:tray',
    onSetActive: '__record__:active',
  });

  await expect(page.getByRole('complementary', { name: 'Variant details' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Variant details' })).toHaveCSS('box-shadow', 'none');
  await expect(page.getByRole('complementary', { name: 'Variant details' })).toHaveCSS('transform', 'none');
  await expect(page.getByRole('complementary', { name: 'Variant details' })).not.toHaveCSS('animation-name', /slideIn/);
  await expect(page.getByRole('heading', { name: 'Crystal Gate' })).toBeVisible();
  await expect(page.getByText('variant-')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close variant details' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close variant details' })).toHaveCSS('position', 'static');
  await expect(page.getByRole('button', { name: 'View full size' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'View full size' }).locator('xpath=ancestor::div[contains(@class, "actions")]')).toHaveCSS('padding-right', '0px');
  const starButton = page.getByRole('button', { name: 'Star variant' });
  await expect(starButton).toHaveAttribute('aria-pressed', 'false');
  await expect(starButton).toHaveText('');
  await expect(starButton.locator('svg')).toHaveCount(1);
  await expect(starButton).toHaveCSS(
    'transition-property',
    'border-color, background-color, color',
  );
  await expect(page.getByRole('button', { name: 'Add to Tray' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'More variant actions' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create relation' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Select variant for collection placement' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Use as main variant' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete variant' })).toHaveCount(0);

  await page.getByRole('button', { name: 'More variant actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'Create relation' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Add to collection' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Use as main variant' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Delete variant' })).toBeVisible();
  await screenshot(page, 'variant-details-panel-action-menu', { fullPage: true });

  await expect(page.getByRole('heading', { name: 'Prompt' })).toHaveCSS('text-transform', 'none');
  await expect(page.getByRole('heading', { name: 'Description' })).toHaveCSS('letter-spacing', 'normal');
  await page.getByRole('button', { name: 'Raw metadata' }).click();
  await expect(page.getByRole('button', { name: 'Raw metadata' })).toHaveCSS('text-transform', 'none');
  await expect(page.getByText('Provider', { exact: true })).toBeVisible();
  await expect(page.getByText('Provider', { exact: true })).toHaveCSS('text-transform', 'none');
  await screenshot(page, 'variant-details-panel-actions', { fullPage: true });

  await starButton.click();
  await page.getByRole('button', { name: 'Add to Tray' }).click();
  await page.getByRole('button', { name: 'More variant actions' }).click();
  await page.getByRole('menuitem', { name: 'Create relation' }).click();
  await page.getByRole('button', { name: 'More variant actions' }).click();
  await page.getByRole('menuitem', { name: 'Add to collection' }).click();
  await page.getByRole('button', { name: 'More variant actions' }).click();
  await page.getByRole('menuitem', { name: 'Use as main variant' }).click();
  await page.getByRole('button', { name: 'More variant actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete variant' }).click();

  const calls = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(calls.map((call) => call.eventName)).toEqual([
    'star',
    'tray',
    'relation',
    'collection',
    'active',
    'delete',
  ]);
});

test('variant details panel keeps mobile inspector within viewport', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await mountComponent(page, 'VariantDetailsPanel', {
    asset,
    variant,
    spaceId: 'space-1',
    isActive: true,
    variantCount: 1,
    lineage: [],
    allVariants: [variant],
    allAssets: [asset],
    onClose: '__record__:close',
    onStarVariant: '__record__:star',
  });

  const bounds = await page.getByRole('complementary', { name: 'Variant details' }).evaluate((panel) => {
    const rect = panel.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });
  expect(bounds.left).toBeGreaterThanOrEqual(16);
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth - 16);
  expect(bounds.top).toBeGreaterThanOrEqual(16);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewportHeight - 16);
});
