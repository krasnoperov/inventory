import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

const imageSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#dde5ff"/><path d="M20 68 42 42l14 16 10-12 12 22z" fill="#6f6ce8"/></svg>';

async function mockImages(page: Page) {
  await page.route('**/api/images/**', (route) => route.fulfill({
    status: 200,
    contentType: 'image/svg+xml',
    body: imageSvg,
  }));
}

async function boxShadow(page: Page, selector: string) {
  return page.locator(selector).first().evaluate((node) => getComputedStyle(node).boxShadow);
}

async function expectNoOverlap(first: Locator, second: Locator) {
  await expect.poll(async () => {
    const firstBox = await first.boundingBox();
    const count = await second.count();
    if (!firstBox || count === 0) return false;
    for (let index = 0; index < count; index += 1) {
      const secondBox = await second.nth(index).boundingBox();
      if (!secondBox) return false;
      const overlaps = !(
        firstBox.x + firstBox.width <= secondBox.x ||
        secondBox.x + secondBox.width <= firstBox.x ||
        firstBox.y + firstBox.height <= secondBox.y ||
        secondBox.y + secondBox.height <= firstBox.y
      );
      if (overlaps) return false;
    }
    return true;
  }).toBe(true);
}

function asset(id: string, name: string, type: string, tags = '[]') {
  return {
    id,
    name,
    type,
    tags,
    media_kind: 'image',
    parent_asset_id: null,
    active_variant_id: `${id}-variant`,
    created_by: 'user-1',
    created_at: 1_700_000_000_000,
    updated_at: 1_700_000_000_000,
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
    image_key: `images/${assetId}.png`,
    thumb_key: `images/${assetId}-thumb.png`,
    media_key: `images/${assetId}.png`,
    media_mime_type: 'image/png',
    media_size_bytes: 2048,
    media_width: 1024,
    media_height: 1024,
    media_duration_ms: null,
    recipe: '{}',
    starred: false,
    created_by: 'user-1',
    created_at: 1_700_000_000_000,
    updated_at: 1_700_000_000_000,
    description: null,
    quality_rating: null,
    rated_at: null,
  };
}

const longAssets = [
  asset(
    'hero',
    'Hero Character With Readable Long Production Name',
    'character-reference-sheet',
    JSON.stringify(['living-room-outro', 'warm-pastel-style']),
  ),
  asset(
    'output',
    'Generated Output Variant With Long Final Label',
    'final-scene-composition',
    JSON.stringify(['final-output']),
  ),
];

const longVariants = longAssets.map((item) => variant(item.id));
const longLineage = [{
  id: 'lineage-long',
  parent_variant_id: 'hero-variant',
  child_variant_id: 'output-variant',
  relation_type: 'derived',
  severed: false,
  created_at: 1_700_000_000_000,
}];
const longCompositions = [{
  id: 'composition-long',
  name: 'Scene Bar Composition With Long Readable Name',
  description: null,
  status: 'draft',
  output_asset_id: 'output',
  output_variant_id: 'output-variant',
  metadata: '{}',
  sort_index: 0,
  created_by: 'user-1',
  created_at: 1_700_000_000_000,
  updated_at: 1_700_000_000_000,
}];
const longCompositionItems = [{
  id: 'composition-item-long',
  composition_id: 'composition-long',
  asset_id: 'hero',
  variant_id: 'hero-variant',
  role: 'character-reference',
  sort_index: 0,
  created_by: 'user-1',
  created_at: 1_700_000_000_000,
  updated_at: 1_700_000_000_000,
}];

test('relations canvas empty state uses minimal chrome', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 640 });
  await mountComponent(page, 'RelationsCanvas', {
    assets: [],
    variants: [],
    lineage: [],
    relations: [],
    collections: [],
    collectionItems: [],
    compositions: [],
    compositionItems: [],
    isInitialSyncPending: false,
    onAssetClick: '__noop__',
  });

  await expect(page.getByText('No assets to chart yet')).toBeVisible();
  await expect(page.locator('[class*="emptyMark"]')).toBeVisible();
  await expect(page.getByText('⊹')).toHaveCount(0);
  await expect(page.getByText('◴')).toHaveCount(0);
  await screenshot(page, 'relations-canvas-empty-state', { fullPage: true });

  await mountComponent(page, 'RelationsCanvas', {
    assets: [],
    variants: [],
    lineage: [],
    relations: [],
    collections: [],
    collectionItems: [],
    compositions: [],
    compositionItems: [],
    isInitialSyncPending: true,
    onAssetClick: '__noop__',
  });

  await expect(page.getByText('Charting relations…')).toBeVisible();
  await expect(page.locator('[class*="emptyMarkLoading"]')).toBeVisible();
  await expect(page.getByText('⊹')).toHaveCount(0);
  await expect(page.getByText('◴')).toHaveCount(0);
});

test('relations canvas dock uses shared controls for graph options', async ({ page }) => {
  await mockImages(page);
  await page.setViewportSize({ width: 980, height: 760 });
  await mountComponent(page, 'RelationsCanvas', {
    onAssetClick: '__record__:assetClick',
  });

  const dock = page.getByRole('toolbar', { name: 'Relations canvas controls' });
  await expect(dock).toBeVisible();
  await expect(dock).toHaveCSS('box-shadow', 'none');
  await expect(page.getByRole('radio', { name: 'Story' })).toBeVisible();

  await page.getByRole('radio', { name: 'Graph' }).click();
  await expect(page.getByRole('radio', { name: 'Clusters' })).toBeVisible();

  await page.getByRole('radio', { name: 'Flow' }).click();
  await page.getByRole('radio', { name: 'Type' }).click();
  await page.getByRole('button', { name: /Relation/ }).click();
  await expect(page.locator('[class*="specimen"]').first()).toHaveCSS('box-shadow', 'none');
  await expect(page.locator('[class*="assembler"]').first()).toHaveCSS('box-shadow', 'none');

  const heroName = page.getByRole('button', { name: 'Hero Character' }).first();
  await expect(heroName).toBeVisible();
  await expect(heroName).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  const starredLedger = page.getByTitle('1 starred').first();
  await expect(starredLedger).toBeVisible();
  await expect(starredLedger).toHaveText('');
  await expect(starredLedger.locator('svg')).toHaveCount(1);
  await expect(page.getByText('★')).toHaveCount(0);
  await expect(page.getByText('IMG').first()).toBeVisible();
  await expect(page.getByText('CMP').first()).toBeVisible();
  await expect(page.getByText('♪')).toHaveCount(0);
  await expect(page.getByText('▶')).toHaveCount(0);
  await expect(page.getByText('◧')).toHaveCount(0);
  await expect(page.getByText('▦')).toHaveCount(0);
  await heroName.click();
  const calls = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(calls).toHaveLength(1);
  expect(calls[0].eventName).toBe('assetClick');
  expect((calls[0].args[0] as { id: string }).id).toBe('hero');

  await page.locator('.react-flow__controls-zoomin').click();
  await page.locator('.react-flow__controls-zoomin').click();
  await screenshot(page, 'relations-canvas-shared-dock', { fullPage: true });

  await expect(page.getByRole('radio', { name: 'Flow' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Type' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Relation/ })).toBeVisible();
});

test('relations canvas focused chrome stays flat', async ({ page }) => {
  await mockImages(page);
  await page.setViewportSize({ width: 980, height: 760 });
  await mountComponent(page, 'RelationsCanvas', {
    onAssetClick: '__record__:assetClick',
  });

  const specimen = page.locator('[class*="specimen"]').first();
  await expect(specimen).toBeVisible();
  await specimen.click({ position: { x: 12, y: 12 } });
  await expect(page.getByText('Lineage of')).toBeVisible();

  await expect.poll(() => boxShadow(page, '[class*="specimen"][class*="focused"]')).not.toContain('24px');
  await screenshot(page, 'relations-canvas-flat-focused-chrome', { fullPage: true });
});

test('relations canvas keeps long labels readable without ellipsis', async ({ page }) => {
  await mockImages(page);
  await page.setViewportSize({ width: 980, height: 760 });
  await mountComponent(page, 'RelationsCanvas', {
    previewWidth: '1100px',
    previewHeight: '760px',
    assets: longAssets,
    variants: longVariants,
    lineage: longLineage,
    relations: [],
    collections: [],
    collectionItems: [],
    compositions: longCompositions,
    compositionItems: longCompositionItems,
    onAssetClick: '__record__:assetClick',
  });

  await page.getByRole('radio', { name: 'Graph' }).click();
  await page.getByRole('radio', { name: 'Flow' }).click();

  const assetName = page.getByRole('button', { name: 'Hero Character With Readable Long Production Name' });
  await expect(assetName).toBeVisible();
  await expect(assetName).toHaveCSS('white-space', 'normal');
  await expect(assetName).toHaveCSS('text-overflow', 'clip');
  await expect(page.getByText('character-reference-sheet')).toBeVisible();
  await expect(page.getByText('Scene Bar Composition With Long Readable Name')).toBeVisible();
  await expectNoOverlap(
    page.getByRole('toolbar', { name: 'Relations canvas controls' }),
    page.locator('[class*="specimen"]'),
  );

  await screenshot(page, 'relations-canvas-readable-long-labels', { fullPage: true });

  await page.locator('[class*="specimen"]').first().click({ position: { x: 12, y: 12 } });
  await expect(page.getByText('Lineage of')).toBeVisible();
  const traceName = page.getByText('Hero Character With Readable Long Production Name').last();
  await expect(traceName).toHaveCSS('white-space', 'normal');
  await expect(traceName).toHaveCSS('text-overflow', 'clip');

  await expect.poll(async () => page.locator('[class*="specimen"]').first().evaluate((node) => {
    const box = node.getBoundingClientRect();
    return node.scrollWidth <= Math.ceil(box.width);
  })).toBe(true);

  await screenshot(page, 'relations-canvas-readable-trace-label', { fullPage: true });
});

test('relations canvas dock wraps controls on mobile', async ({ page }) => {
  await mockImages(page);
  await page.setViewportSize({ width: 390, height: 720 });
  await mountComponent(page, 'RelationsCanvas', {
    onAssetClick: '__record__:assetClick',
  });

  await page.getByRole('radio', { name: 'Graph' }).click();
  await expect(page.getByRole('radio', { name: 'Type' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Composition/ })).toBeVisible();

  const dock = page.getByRole('toolbar', { name: 'Relations canvas controls' });
  await expect.poll(async () => dock.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= window.innerWidth;
  })).toBe(true);
  await screenshot(page, 'relations-canvas-dock-mobile', { fullPage: true });
});
