import { expect, test } from '@playwright/test';
import { screenshot } from './harness';

const t = 1_700_000_000_000;
const asset = (id: string, name: string) => ({
  id, name, type: 'sprite', media_kind: 'image', tags: '', parent_asset_id: null,
  active_variant_id: `${id}-v`, created_by: 'u1', created_at: t, updated_at: t,
});
const variant = (assetId: string) => ({
  id: `${assetId}-v`, asset_id: assetId, media_kind: 'image', workflow_id: null, status: 'completed',
  error_message: null, image_key: null, thumb_key: null, media_key: null, media_mime_type: 'image/png',
  media_size_bytes: 1, media_width: 512, media_height: 512, media_duration_ms: null, recipe: '{}',
  starred: false, created_by: 'u1', created_at: t, updated_at: t, description: null,
});
const lin = (id: string, p: string, c: string) => ({
  id, parent_variant_id: `${p}-v`, child_variant_id: `${c}-v`, relation_type: 'derived', severed: false, created_at: t,
});

const families = ['wheat', 'corn', 'tomato'];
const assets = [asset('crops', 'Raw source: crops')];
const lineage: ReturnType<typeof lin>[] = [];
families.forEach((f) => {
  assets.push(asset(`${f}_grow`, `Sprite: ${f}_grow`));
  lineage.push(lin(`l-${f}`, 'crops', `${f}_grow`));
});
const allVariants = assets.map((a) => variant(a.id));

async function mockMedia(page: import('@playwright/test').Page) {
  const image = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="180"><rect width="240" height="180" fill="#668cff"/><circle cx="120" cy="90" r="42" fill="#ffffff"/></svg>';
  await page.route('**/api/images/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: image,
    }),
  );
  await page.route('**/api/spaces/**/variants/**/media', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: image,
    }),
  );
}

async function sizeCanvasHarness(page: import('@playwright/test').Page) {
  await page.addStyleTag({ content: '[data-testid="harness-root"]{position:fixed;inset:0;}' });
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

async function expectLocatorAfterShadow(
  page: import('@playwright/test').Page,
  locator: import('@playwright/test').Locator,
  shadow: string,
) {
  await expect.poll(
    async () => locator.evaluate((node) => getComputedStyle(node, '::after').boxShadow),
  ).toBe(await resolvedShadow(page, shadow));
}

// The detail view drops its separate "Derivatives:" text list because the
// canvas already shows derivatives as clickable lineage nodes. Guard that.
test('variant canvas shows derivatives as lineage nodes', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/component-harness.html?component=VariantCanvas', { waitUntil: 'domcontentloaded' });
  // Harness root is unsized; VariantCanvas's .canvas is height:100%.
  await sizeCanvasHarness(page);
  await page.evaluate((p) => (window as unknown as { __setHarnessProps: (x: unknown) => void }).__setHarnessProps(p), {
    spaceId: 'space-1', asset: assets[0], variants: [variant('crops')], lineage,
    selectedVariantId: 'crops-v', allVariants, allAssets: assets,
    onVariantClick: '__noop__', onGhostNodeClick: '__noop__',
  });
  await page.waitForSelector('.react-flow__node');
  for (const f of families) {
    await expect(page.getByText(`Sprite: ${f}_grow`)).toBeVisible();
  }
  await expect(page.locator('.react-flow__node [class*="label"]').first()).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  const ghostLabel = page.getByTitle('To: Sprite: wheat_grow');
  const ghostNode = ghostLabel.locator('xpath=ancestor::div[contains(@class, "node")][1]');
  const ghostPreview = ghostNode.locator('[class*="thumbnail"]').first();
  await expectLocatorAfterShadow(page, ghostPreview, 'var(--relation-ring)');
  await screenshot(page, 'variant-canvas-lineage-labels', { fullPage: true });
});

test('variant canvas retries failed audio variants and renders queued state', async ({ page }) => {
  const audioAsset = {
    ...asset('audio', 'Door knock'),
    type: 'sfx',
    media_kind: 'audio',
    active_variant_id: 'audio-v',
  };
  const failedAudioVariant = {
    ...variant('audio'),
    media_kind: 'audio',
    status: 'failed',
    error_message: 'provider failed',
    media_key: null,
    media_mime_type: null,
  };
  const pendingAudioVariant = {
    ...failedAudioVariant,
    status: 'pending',
    error_message: null,
  };

  await page.setViewportSize({ width: 900, height: 650 });
  await page.goto('/component-harness.html?component=VariantCanvas', { waitUntil: 'domcontentloaded' });
  await sizeCanvasHarness(page);
  await page.evaluate((p) => (window as unknown as { __setHarnessProps: (x: unknown) => void }).__setHarnessProps(p), {
    spaceId: 'space-1',
    asset: audioAsset,
    variants: [failedAudioVariant],
    lineage: [],
    selectedVariantId: 'audio-v',
    allVariants: [failedAudioVariant],
    allAssets: [audioAsset],
    onRetry: '__record__:retry',
  });

  await page.getByRole('button', { name: 'Retry' }).click();
  const calls = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(calls).toHaveLength(1);
  expect(calls[0].eventName).toBe('retry');
  expect(calls[0].args[0]).toBe('audio-v');

  await page.evaluate((p) => (window as unknown as { __setHarnessProps: (x: unknown) => void }).__setHarnessProps(p), {
    spaceId: 'space-1',
    asset: audioAsset,
    variants: [pendingAudioVariant],
    lineage: [],
    selectedVariantId: 'audio-v',
    allVariants: [pendingAudioVariant],
    allAssets: [audioAsset],
    onRetry: '__record__:retry',
  });
  await expect(page.getByText('Queued')).toBeVisible();
});

test('variant canvas previews stay free of hover action overlays', async ({ page }) => {
  const cleanAsset = {
    ...asset('crystal', 'Crystal Gate'),
    type: 'prop',
    active_variant_id: 'crystal-v',
  };
  const cleanVariant = {
    ...variant('crystal'),
    id: 'crystal-v',
    image_key: 'images/space/crystal-v.png',
    thumb_key: 'images/space/crystal-v_thumb.webp',
    media_key: 'images/space/crystal-v.png',
    media_width: 240,
    media_height: 180,
    recipe: JSON.stringify({ prompt: 'A blue crystal gate.' }),
  };

  await mockMedia(page);
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.goto('/component-harness.html?component=VariantCanvas', { waitUntil: 'domcontentloaded' });
  await sizeCanvasHarness(page);
  await page.evaluate((p) => (window as unknown as { __setHarnessProps: (x: unknown) => void }).__setHarnessProps(p), {
    spaceId: 'space-1',
    asset: cleanAsset,
    variants: [cleanVariant],
    lineage: [],
    selectedVariantId: 'crystal-v',
    allVariants: [cleanVariant],
    allAssets: [cleanAsset],
    onVariantClick: '__record__:variant-click',
    onAddToTray: '__record__:tray',
    onSetActive: '__record__:active',
  });

  await expect(page.locator('.react-flow__node')).toBeVisible();
  const preview = page.locator('[class*="thumbnail"]').first();
  await expect(preview.locator('img')).toBeVisible();
  await preview.hover();
  await expect(page.getByRole('button', { name: 'View full size' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add to Tray' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Use as main variant' })).toHaveCount(0);
  await screenshot(page, 'variant-canvas-clean-node', { fullPage: true });

  await preview.click();
  await expect(page.getByRole('complementary', { name: 'Variant details' })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__componentHarnessCalls ?? []))
    .toContain('variant-click');
});

test('variant canvas active and forked-from chrome uses tokenized surfaces', async ({ page }) => {
  const source = asset('source', 'Source sprite');
  const forked = {
    ...asset('forked', 'Forked sprite'),
    active_variant_id: 'forked-v',
  };
  const forkedVariant = {
    ...variant('forked'),
    id: 'forked-v',
    image_key: 'images/space/forked-v.png',
    thumb_key: 'images/space/forked-v_thumb.webp',
    media_key: 'images/space/forked-v.png',
    media_width: 240,
    media_height: 180,
  };
  const sourceVariant = {
    ...variant('source'),
    id: 'source-v',
  };
  const forkedLineage = [{
    id: 'fork-source-to-forked',
    parent_variant_id: sourceVariant.id,
    child_variant_id: forkedVariant.id,
    relation_type: 'forked',
    severed: false,
    created_at: t,
  }];

  await mockMedia(page);
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.goto('/component-harness.html?component=VariantCanvas', { waitUntil: 'domcontentloaded' });
  await sizeCanvasHarness(page);
  await page.evaluate((p) => (window as unknown as { __setHarnessProps: (x: unknown) => void }).__setHarnessProps(p), {
    spaceId: 'space-1',
    asset: forked,
    variants: [forkedVariant],
    lineage: forkedLineage,
    selectedVariantId: 'forked-v',
    allVariants: [forkedVariant, sourceVariant],
    allAssets: [source, forked],
    onVariantClick: '__record__:variant-click',
    onGhostNodeClick: '__record__:ghost-click',
  });

  await expect(page.locator('.react-flow__node')).toBeVisible();
  const activePreview = page.locator('[class*="thumbnail"]').first();
  const completedSurface = await resolvedBackground(page, 'var(--color-status-completed-bg)');
  const completedSurfacePattern = completedSurface.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await expect(activePreview).toHaveCSS('box-shadow', new RegExp(completedSurfacePattern));
  const forkedFrom = page.getByTitle('Forked from: Source sprite');
  await expect(forkedFrom).toHaveCSS(
    'background-color',
    completedSurface,
  );
  await forkedFrom.hover();
  await expect(forkedFrom).toHaveCSS(
    'background-color',
    completedSurface,
  );
  await screenshot(page, 'variant-canvas-tokenized-node-chrome', { fullPage: true });
});
