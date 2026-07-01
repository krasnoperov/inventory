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

async function expectNodeChromeBelowMedia(
  node: import('@playwright/test').Locator,
) {
  const boxes = await node.evaluate((element) => {
    const mediaElement = element.querySelector('[class*="thumbnail"], [class*="audioCard"]');
    const chromeElement = element.querySelector('[class*="nodeChrome"]');
    const mediaBox = mediaElement?.getBoundingClientRect();
    const chromeBox = chromeElement?.getBoundingClientRect();
    return mediaBox && chromeBox
      ? { mediaBottom: mediaBox.bottom, chromeTop: chromeBox.top }
      : null;
  });
  expect(boxes).not.toBeNull();
  expect(boxes!.chromeTop).toBeGreaterThanOrEqual(boxes!.mediaBottom);
}

test('variant canvas empty state uses minimal chrome', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 520 });
  await page.goto('/component-harness.html?component=VariantCanvas', { waitUntil: 'domcontentloaded' });
  await sizeCanvasHarness(page);
  await page.evaluate((p) => (window as unknown as { __setHarnessProps: (x: unknown) => void }).__setHarnessProps(p), {
    spaceId: 'space-1',
    canvasLabel: 'Details canvas',
    scope: 'asset-details',
    asset: asset('empty', 'Empty asset'),
    variants: [],
    lineage: [],
    allVariants: [],
    allAssets: [asset('empty', 'Empty asset')],
    onVariantClick: '__noop__',
  });

  await expect(page.getByRole('region', { name: 'Details canvas' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Details canvas' })).toHaveAttribute('data-canvas-scope', 'asset-details');
  const emptyBackground = await page.getByRole('region', { name: 'Details canvas' }).evaluate((node) => getComputedStyle(node).backgroundImage);
  expect((emptyBackground.match(/linear-gradient/g) ?? [])).toHaveLength(3);
  await expect(page.getByText('No variants in this asset yet')).toBeVisible();
  await expect(page.locator('[class*="emptyMark"]')).toBeVisible();
  await expect(page.getByText('🎨')).toHaveCount(0);
  await expect(page.getByText('Use the Forge Tray below')).toHaveCount(0);
  await screenshot(page, 'variant-canvas-empty-state', { fullPage: true });
});

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
    onVariantClick: '__noop__', onGhostNodeClick: '__record__:ghost-click',
  });
  await page.waitForSelector('.react-flow__node');
  await expect(page.locator('.react-flow__controls').first()).toHaveCSS('box-shadow', 'none');
  await expect(page.locator('.react-flow__controls').first()).toHaveCSS('border-top-width', '1px');
  await expect(page.locator('.react-flow__minimap').first()).toHaveCSS('box-shadow', 'none');
  await expect(page.locator('.react-flow__minimap').first()).toHaveCSS('border-top-width', '1px');
  for (const f of families) {
    await expect(page.getByText(`Sprite: ${f}_grow`)).toBeVisible();
  }
  await expect(page.locator('.react-flow__node [class*="statusRow"]').first()).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  const ghostLabel = page.getByTitle('To: Sprite: wheat_grow');
  const ghostNode = ghostLabel.locator('xpath=ancestor::div[contains(@class, "react-flow__node")][1]');
  const ghostPreview = ghostNode.locator('[class*="thumbnail"]').first();
  await expectLocatorAfterShadow(page, ghostPreview, 'var(--relation-ring)');
  await expect(ghostNode.locator('[class*="statusRow"]')).toContainText('Linked variant');
  await expectNodeChromeBelowMedia(ghostNode);
  await ghostLabel.click();
  const calls = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(calls).toContainEqual(expect.objectContaining({
    eventName: 'ghost-click',
    args: ['wheat_grow'],
  }));
  await screenshot(page, 'variant-canvas-flat-flow-controls', { fullPage: true });
});

test('asset-scoped variant details dock beside the clicked node', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 720 });
  await mockMedia(page);
  await page.goto('/component-harness.html?component=VariantCanvas', { waitUntil: 'domcontentloaded' });
  await sizeCanvasHarness(page);
  const scopedAsset = asset('icon', 'App Icon');
  const scopedVariant = variant('icon');
  await page.evaluate((p) => (window as unknown as { __setHarnessProps: (x: unknown) => void }).__setHarnessProps(p), {
    spaceId: 'space-1',
    canvasLabel: 'Details canvas',
    scope: 'asset-details',
    avoidGenerationDock: true,
    asset: scopedAsset,
    variants: [scopedVariant],
    lineage: [],
    selectedVariantId: scopedVariant.id,
    allVariants: [scopedVariant],
    allAssets: [scopedAsset],
    onVariantClick: '__noop__',
  });

  await page.waitForSelector('.react-flow__node');
  await expect(page.locator('.react-flow__minimap')).toHaveCount(0);
  const node = page.locator('.react-flow__node').first();
  await node.click();
  const detailsPanel = page.getByRole('complementary', { name: 'Variant details' });
  await expect(detailsPanel).toBeVisible();
  await expect(detailsPanel).toHaveCSS('position', 'absolute');
  await expect(detailsPanel).toHaveCSS('border-radius', '12px');

  const overlaps = await page.evaluate(() => {
    const node = document.querySelector('.react-flow__node');
    const panel = document.querySelector('[aria-label="Variant details"]');
    if (!node || !panel) return true;
    const a = node.getBoundingClientRect();
    const b = panel.getBoundingClientRect();
    return !(
      a.right <= b.left ||
      b.right <= a.left ||
      a.bottom <= b.top ||
      b.bottom <= a.top
    );
  });
  expect(overlaps).toBe(false);
  const overlapsControls = await page.evaluate(() => {
    const controls = document.querySelector('.react-flow__controls');
    const panel = document.querySelector('[aria-label="Variant details"]');
    if (!controls || !panel) return true;
    const a = controls.getBoundingClientRect();
    const b = panel.getBoundingClientRect();
    return !(
      a.right <= b.left ||
      b.right <= a.left ||
      a.bottom <= b.top ||
      b.bottom <= a.top
    );
  });
  expect(overlapsControls).toBe(false);
  await page.waitForTimeout(200);
  await screenshot(page, 'variant-canvas-details-docked-beside-node', { fullPage: true });
});

test('asset-scoped variant details keep the clicked node visible on tablet widths', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 720 });
  await mockMedia(page);
  await page.goto('/component-harness.html?component=VariantCanvas', { waitUntil: 'domcontentloaded' });
  await sizeCanvasHarness(page);
  const scopedAsset = asset('icon', 'App Icon');
  const scopedVariant = variant('icon');
  await page.evaluate((p) => (window as unknown as { __setHarnessProps: (x: unknown) => void }).__setHarnessProps(p), {
    spaceId: 'space-1',
    canvasLabel: 'Details canvas',
    scope: 'asset-details',
    avoidGenerationDock: true,
    asset: scopedAsset,
    variants: [scopedVariant],
    lineage: [],
    selectedVariantId: scopedVariant.id,
    allVariants: [scopedVariant],
    allAssets: [scopedAsset],
    onVariantClick: '__noop__',
  });

  await page.waitForSelector('.react-flow__node');
  const node = page.locator('.react-flow__node').first();
  await node.click();
  const detailsPanel = page.getByRole('complementary', { name: 'Variant details' });
  await expect(detailsPanel).toBeVisible();
  await expect(detailsPanel).toHaveCSS('position', 'absolute');

  const geometry = await page.evaluate(() => {
    const node = document.querySelector('.react-flow__node');
    const panel = document.querySelector('[aria-label="Variant details"]');
    const controls = document.querySelector('.react-flow__controls');
    if (!node || !panel || !controls) return null;
    const nodeBox = node.getBoundingClientRect();
    const panelBox = panel.getBoundingClientRect();
    const controlsBox = controls.getBoundingClientRect();
    const overlaps = (a: DOMRect, b: DOMRect) => !(
      a.right <= b.left ||
      b.right <= a.left ||
      a.bottom <= b.top ||
      b.bottom <= a.top
    );
    return {
      panelOverlapsNode: overlaps(nodeBox, panelBox),
      panelOverlapsControls: overlaps(controlsBox, panelBox),
      panelTop: panelBox.top,
      nodeBottom: nodeBox.bottom,
    };
  });
  expect(geometry).not.toBeNull();
  expect(geometry!.panelOverlapsNode).toBe(false);
  expect(geometry!.panelOverlapsControls).toBe(false);
  expect(geometry!.panelTop).toBeGreaterThan(geometry!.nodeBottom);

  await page.waitForTimeout(200);
  await screenshot(page, 'variant-canvas-details-tablet-visible-node', { fullPage: true });
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
  await expect(page.locator('.react-flow__node').first().locator('[class*="statusRow"]')).toContainText('Variant');
  await expectNodeChromeBelowMedia(page.locator('.react-flow__node').first());
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

test('variant canvas reads as a scoped asset variant canvas', async ({ page }) => {
  const scopedAsset = {
    ...asset('scope', 'Crystal Gate'),
    active_variant_id: 'scope-v',
  };
  const firstVariant = {
    ...variant('scope'),
    id: 'scope-v',
    image_key: 'images/space/scope-v.png',
    thumb_key: 'images/space/scope-v_thumb.webp',
    media_key: 'images/space/scope-v.png',
    media_width: 240,
    media_height: 180,
  };
  const secondVariant = {
    ...variant('scope'),
    id: 'scope-v2',
    image_key: 'images/space/scope-v2.png',
    thumb_key: 'images/space/scope-v2_thumb.webp',
    media_key: 'images/space/scope-v2.png',
    media_width: 240,
    media_height: 180,
    created_at: t + 1,
    updated_at: t + 1,
  };

  await mockMedia(page);
  await page.setViewportSize({ width: 1100, height: 720 });
  await page.goto('/component-harness.html?component=VariantCanvas', { waitUntil: 'domcontentloaded' });
  await sizeCanvasHarness(page);
  await page.evaluate((p) => (window as unknown as { __setHarnessProps: (x: unknown) => void }).__setHarnessProps(p), {
    spaceId: 'space-1',
    canvasLabel: 'Details canvas',
    scope: 'asset-details',
    asset: scopedAsset,
    variants: [firstVariant, secondVariant],
    lineage: [],
    selectedVariantId: 'scope-v',
    allVariants: [firstVariant, secondVariant],
    allAssets: [scopedAsset],
    onVariantClick: '__record__:variant-click',
  });

  await page.waitForSelector('[class*="ready"] .react-flow__node');
  await expect(page.getByRole('region', { name: 'Details canvas' })).toHaveAttribute('data-canvas-scope', 'asset-details');
  const canvasBackground = await page.getByRole('region', { name: 'Details canvas' }).evaluate((node) => getComputedStyle(node).backgroundImage);
  expect(canvasBackground).toContain('linear-gradient');
  await expect(page.getByText('Variant 1/2')).toBeVisible();
  await expect(page.getByText('Variant 2/2')).toBeVisible();
  await expect(page.getByText('Asset', { exact: true })).toHaveCount(0);
  await expectNodeChromeBelowMedia(page.locator('.react-flow__node').first());
  await screenshot(page, 'variant-canvas-scoped-asset-variants', { fullPage: true });
});

test('variant canvas starred chrome stays flat', async ({ page }) => {
  const starredAsset = {
    ...asset('starred', 'Starred Sprite'),
    active_variant_id: 'starred-v',
  };
  const starredVariant = {
    ...variant('starred'),
    id: 'starred-v',
    starred: true,
    image_key: 'images/space/starred-v.png',
    thumb_key: 'images/space/starred-v_thumb.webp',
    media_key: 'images/space/starred-v.png',
    media_width: 240,
    media_height: 180,
  };

  await mockMedia(page);
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.goto('/component-harness.html?component=VariantCanvas', { waitUntil: 'domcontentloaded' });
  await sizeCanvasHarness(page);
  await page.evaluate((p) => (window as unknown as { __setHarnessProps: (x: unknown) => void }).__setHarnessProps(p), {
    spaceId: 'space-1',
    asset: starredAsset,
    variants: [starredVariant],
    lineage: [],
    selectedVariantId: 'starred-v',
    allVariants: [starredVariant],
    allAssets: [starredAsset],
    onVariantClick: '__record__:variant-click',
  });

  await expect(page.getByText('★')).toHaveCount(0);
  await expect(page.getByTitle('Starred variant')).toBeVisible();
  const preview = page.locator('[class*="thumbnail"]').first();
  await expect(preview.locator('[class*="starIndicator"]')).toHaveCount(0);
  await page.locator('[class*="canvas"]').first().evaluate((element) => {
    (element as HTMLElement).style.setProperty('--rf-zoom', '0.3');
  });
  const starredChrome = page.getByTitle('Starred variant');
  const boxes = await page.evaluate(() => {
    const previewElement = document.querySelector('[class*="thumbnail"]');
    const chromeElement = document.querySelector('[class*="starIndicator"]');
    const previewBox = previewElement?.getBoundingClientRect();
    const chromeBox = chromeElement?.getBoundingClientRect();
    return previewBox && chromeBox
      ? { previewRight: previewBox.right, chromeLeft: chromeBox.left }
      : null;
  });
  expect(boxes).not.toBeNull();
  expect(boxes!.chromeLeft).toBeGreaterThanOrEqual(boxes!.previewRight);
  await expect(starredChrome).toHaveCSS('transform', 'none');
  await page.locator('[class*="canvas"]').first().evaluate((element) => {
    (element as HTMLElement).style.setProperty('--rf-zoom', '1');
  });
  await expect(preview).toHaveCSS(
    'box-shadow',
    await resolvedShadow(page, '-3px 0 0 var(--color-success), 0 0 0 2px var(--color-star-border)'),
  );
  await page.waitForSelector('[class*="ready"] .react-flow__node');
  await screenshot(page, 'variant-canvas-starred-flat-chrome');
});

test('variant canvas hover chrome stays flat', async ({ page }) => {
  const hoverAsset = {
    ...asset('hover', 'Hover Sprite'),
    active_variant_id: null,
  };
  const hoverVariant = {
    ...variant('hover'),
    id: 'hover-v',
    image_key: 'images/space/hover-v.png',
    thumb_key: 'images/space/hover-v_thumb.webp',
    media_key: 'images/space/hover-v.png',
    media_width: 240,
    media_height: 180,
  };

  await mockMedia(page);
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.goto('/component-harness.html?component=VariantCanvas', { waitUntil: 'domcontentloaded' });
  await sizeCanvasHarness(page);
  await page.evaluate((p) => (window as unknown as { __setHarnessProps: (x: unknown) => void }).__setHarnessProps(p), {
    spaceId: 'space-1',
    asset: hoverAsset,
    variants: [hoverVariant],
    lineage: [],
    allVariants: [hoverVariant],
    allAssets: [hoverAsset],
    onVariantClick: '__record__:variant-click',
  });

  const preview = page.locator('[class*="thumbnail"]').first();
  await expect(preview.locator('img')).toBeVisible();
  await expect(page.locator('.react-flow__node').first().locator('[class*="statusRow"]')).toContainText('Variant');
  await preview.hover();
  await expect(preview).toHaveCSS('box-shadow', 'none');
  await page.waitForSelector('[class*="ready"] .react-flow__node');
  await screenshot(page, 'variant-canvas-flat-hover-chrome');
});

test('variant canvas selected node uses flat selection chrome', async ({ page }) => {
  const selectedAsset = {
    ...asset('selected', 'Selected Sprite'),
    active_variant_id: null,
  };
  const selectedVariant = {
    ...variant('selected'),
    id: 'selected-v',
    image_key: 'images/space/selected-v.png',
    thumb_key: 'images/space/selected-v_thumb.webp',
    media_key: 'images/space/selected-v.png',
    media_width: 240,
    media_height: 180,
  };

  await mockMedia(page);
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.goto('/component-harness.html?component=VariantCanvas', { waitUntil: 'domcontentloaded' });
  await sizeCanvasHarness(page);
  await page.evaluate((p) => (window as unknown as { __setHarnessProps: (x: unknown) => void }).__setHarnessProps(p), {
    spaceId: 'space-1',
    asset: selectedAsset,
    variants: [selectedVariant],
    lineage: [],
    selectedVariantId: 'selected-v',
    allVariants: [selectedVariant],
    allAssets: [selectedAsset],
    onVariantClick: '__record__:variant-click',
  });

  const preview = page.locator('[class*="thumbnail"]').first();
  await expect(preview.locator('img')).toBeVisible();
  await expect(page.locator('.react-flow__node').first().locator('[class*="statusRow"]')).toContainText('Selected');
  await expectNodeChromeBelowMedia(page.locator('.react-flow__node').first());
  await expect(preview).toHaveCSS(
    'box-shadow',
    await resolvedShadow(page, 'var(--selection-ring)'),
  );
  await screenshot(page, 'variant-canvas-selected-flat-chrome');
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
  await expect(page.locator('.react-flow__node').first().locator('[class*="statusRow"]')).toContainText('Main');
  await expect(page.locator('.react-flow__node').first().locator('[class*="statusRow"]')).toContainText('Selected');
  await expectNodeChromeBelowMedia(page.locator('.react-flow__node').first());
  await expect(activePreview).toHaveCSS(
    'box-shadow',
    await resolvedShadow(page, '-3px 0 0 var(--color-success)'),
  );
  const completedSurface = await resolvedBackground(page, 'var(--color-status-completed-bg)');
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
