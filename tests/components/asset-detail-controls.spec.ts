import { expect, test } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

const baseTime = 1_700_000_000_000;

function asset(overrides: Record<string, unknown> = {}) {
  return {
    id: 'asset-1',
    name: 'Hero reveal video',
    type: 'animation',
    media_kind: 'video',
    tags: '',
    parent_asset_id: null,
    active_variant_id: 'variant-video',
    created_by: 'user-1',
    created_at: baseTime,
    updated_at: baseTime,
    ...overrides,
  };
}

function fullVariant(overrides: Record<string, unknown> = {}) {
  return {
    id: 'variant-video',
    asset_id: 'asset-1',
    media_kind: 'video',
    workflow_id: null,
    status: 'completed',
    error_message: null,
    image_key: null,
    thumb_key: 'thumbs/hero-reveal.webp',
    media_key: 'videos/hero-reveal.mp4',
    media_mime_type: 'video/mp4',
    media_size_bytes: 1200000,
    media_width: 1920,
    media_height: 1080,
    media_duration_ms: 8000,
    recipe: '{}',
    starred: false,
    created_by: 'user-1',
    created_at: baseTime,
    updated_at: baseTime,
    description: null,
    quality_rating: null,
    rated_at: null,
    ...overrides,
  };
}

async function selectDropdown(page: import('@playwright/test').Page, label: string, optionName: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: optionName, exact: true }).click();
}

async function expectNoOverlap(
  first: import('@playwright/test').Locator,
  second: import('@playwright/test').Locator,
) {
  await expect.poll(async () => {
    const firstBox = await first.boundingBox();
    const secondBox = await second.boundingBox();
    if (!firstBox || !secondBox) return false;
    return !(
      firstBox.x + firstBox.width <= secondBox.x ||
      secondBox.x + secondBox.width <= firstBox.x ||
      firstBox.y + firstBox.height <= secondBox.y ||
      secondBox.y + secondBox.height <= firstBox.y
    );
  }).toBe(false);
}

async function visibleHeightInViewport(locator: import('@playwright/test').Locator) {
  return locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return Math.max(0, Math.min(window.innerHeight, box.bottom) - Math.max(0, box.top));
  });
}

async function visibleRatioInViewport(locator: import('@playwright/test').Locator) {
  return locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const visibleHeight = Math.max(0, Math.min(window.innerHeight, box.bottom) - Math.max(0, box.top));
    return box.height > 0 ? visibleHeight / box.height : 0;
  });
}

test('asset detail title rename uses shared inline field', async ({ page }) => {
  await page.setViewportSize({ width: 520, height: 180 });
  await mountComponent(page, 'AssetTitleInlineEditor', {
    assetName: 'Hero Character',
    editingName: false,
    editNameValue: '',
    onEditNameValueChange: '__record__:editName',
    onNameKeyDown: '__noop__',
    onSaveName: '__record__:saveName',
    onStartEditName: '__record__:startEdit',
  });

  await expect(page.getByRole('button', { name: 'Rename Hero Character' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Hero Character' })).toBeVisible();
  await screenshot(page, 'asset-title-rename-trigger', { fullPage: true });

  await mountComponent(page, 'AssetTitleInlineEditor', {
    assetName: 'Hero Character',
    editingName: true,
    editNameValue: 'Hero Character',
    onEditNameValueChange: '__record__:editName',
    onNameKeyDown: '__noop__',
    onSaveName: '__record__:saveName',
    onStartEditName: '__record__:startEdit',
  });

  const input = page.getByLabel('Asset name');
  await expect(input).toBeFocused();
  await input.fill('Hero Portrait');
  await screenshot(page, 'asset-title-inline-editor', { fullPage: true });
  await input.blur();

  const calls = await page.evaluate(() => window.__componentHarnessCalls ?? []);
  expect(calls).toEqual(expect.arrayContaining([
    'editName:["Hero Portrait"]',
  ]));
});

test('asset details strip makes video facts visible without dock disclosure chrome', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 420 });
  await mountComponent(page, 'AssetDetailsStrip', {
    asset: asset(),
    assetTypeDisabled: false,
    onAssetTypeChange: '__record__:type',
    selectedVariant: fullVariant(),
    selectedVariantIndex: 0,
    variantCount: 3,
  });

  await expect(page.getByRole('region', { name: 'Details scoped space summary', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Details scoped space summary', exact: true })).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.getByRole('region', { name: 'Details scoped space summary', exact: true })).toHaveCSS('border-top-width', '1px');
  await expect(page.getByRole('region', { name: 'Details scoped space summary', exact: true })).toHaveCSS('border-left-width', '1px');
  await expect(page.getByRole('region', { name: 'Details scoped space summary', exact: true })).toHaveCSS('border-radius', '8px');
  await expect(page.getByText('Hero reveal video')).toBeVisible();
  await expect(page.getByLabel('Asset scope', { exact: true })).toContainText('Details');
  await expect(page.getByText('Asset', { exact: true })).toHaveCSS('text-transform', 'none');
  await expect(page.getByText('Asset', { exact: true })).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(page.getByText('Asset', { exact: true })).toHaveCSS('border-top-width', '0px');
  await expect(page.getByText('Video', { exact: true })).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(page.getByLabel('Variants scope')).toContainText('Variants');
  await expect(page.getByLabel('Variants scope')).toHaveCSS('border-left-width', '0px');
  await expect(page.getByLabel('Variants scope')).toContainText('Variant 1/3');
  await expect(page.getByText('Video', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Asset type' })).toBeVisible();
  await selectDropdown(page, 'Asset type', 'Environment');
  await expect(page.getByText('Video · Completed')).toBeVisible();
  await expect(page.getByText('1920x1080')).toBeVisible();
  await expect(page.getByText('8.0s')).toBeVisible();
  const factsChrome = await page.getByRole('region', { name: 'Details scoped space summary', exact: true }).evaluate((node) => {
    const factCells = [...node.querySelectorAll('dl > div')];
    return factCells.map((cell) => getComputedStyle(cell).backgroundColor);
  });
  expect(new Set(factsChrome)).toEqual(new Set(['rgba(0, 0, 0, 0)']));
  await expect(page.getByRole('button', { name: /asset scope details/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Scope' })).toHaveCount(0);
  await screenshot(page, 'asset-details-strip-video', { fullPage: true });

  const calls = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(calls).toEqual(expect.arrayContaining([
    { eventName: 'type', args: ['environment'] },
  ]));
});

test('asset details strip also exposes image facts without a hidden click target', async ({ page }) => {
  await page.setViewportSize({ width: 620, height: 360 });
  await mountComponent(page, 'AssetDetailsStrip', {
    asset: asset({
      name: 'Hero portrait',
      type: 'character',
      media_kind: 'image',
    }),
    selectedVariant: fullVariant({
      media_kind: 'image',
      media_key: 'images/hero.png',
      media_mime_type: 'image/png',
      media_width: 1024,
      media_height: 1024,
      media_duration_ms: null,
    }),
    selectedVariantIndex: 0,
    variantCount: 1,
  });

  await expect(page.getByRole('region', { name: 'Details scoped space summary', exact: true })).toBeVisible();
  await expect(page.getByText('Hero portrait')).toBeVisible();
  await expect(page.getByText('Image', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Variants scope')).toContainText('Variant 1/1');
  await expect(page.getByLabel('Variants scope')).toContainText('Image · Completed');
  await expect(page.getByText('Character')).toBeVisible();
  await expect(page.getByText('Image · Completed')).toBeVisible();
  await expect(page.getByText('1024x1024')).toBeVisible();
  await expect(page.getByText('Duration')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /asset scope details/i })).toHaveCount(0);
});

test('asset details strip keeps variant focus visible without a selected variant', async ({ page }) => {
  await page.setViewportSize({ width: 620, height: 360 });
  await mountComponent(page, 'AssetDetailsStrip', {
    asset: asset({
      name: 'Unselected detail',
      type: 'character',
      media_kind: 'image',
    }),
    selectedVariant: null,
    variantCount: 2,
  });

  await expect(page.getByRole('region', { name: 'Details scoped space summary', exact: true })).toBeVisible();
  await expect(page.getByText('Unselected detail')).toBeVisible();
  await expect(page.getByLabel('Variants scope')).toContainText('2 variants');
  await expect(page.getByLabel('Variants scope')).toContainText('None');
  await expect(page.getByRole('button', { name: /asset scope details/i })).toHaveCount(0);
  await screenshot(page, 'asset-details-strip-no-variant', { fullPage: true });
});

test('asset details dock avoids ellipsis in screenshot-like audio summary', async ({ page }) => {
  await page.setViewportSize({ width: 1040, height: 620 });
  await mountComponent(page, 'AssetGenerationDockAudioNoEllipsis', {});

  const summary = page.getByRole('region', { name: 'Details scoped space summary', exact: true });
  await expect(summary).toBeVisible();
  await expect(summary).toContainText('Shorts outro - living room narration with a longer readable name');
  await expect(summary).toContainText('Variant 1/1 · Audio · Completed');
  await expect(summary).toContainText('Duration');
  await expect(summary).toContainText('4.8s');
  await expect(summary.locator('[class*="assetDetailsName"]')).toHaveCSS('white-space', 'normal');
  await expect(summary.locator('[class*="variantFocusValue"]')).toHaveCSS('white-space', 'normal');
  await expect(summary.locator('[class*="assetDetailsName"]')).not.toHaveCSS('text-overflow', 'ellipsis');
  await expect(summary.locator('[class*="variantFocusValue"]')).not.toHaveCSS('text-overflow', 'ellipsis');
  await expect(summary).not.toContainText('Details...');
  await expect(summary).not.toContainText('Asset...');
  await expect(summary).not.toContainText('A...');
  await screenshot(page, 'asset-details-dock-audio-no-ellipsis', { fullPage: true });
});

test('asset details strip names audio details explicitly', async ({ page }) => {
  await page.setViewportSize({ width: 620, height: 360 });
  await mountComponent(page, 'AssetDetailsStrip', {
    asset: asset({
      name: 'Narration pass',
      type: 'sound',
      media_kind: 'audio',
    }),
    selectedVariant: fullVariant({
      media_kind: 'audio',
      media_key: 'audio/narration.mp3',
      media_mime_type: 'audio/mpeg',
      media_width: null,
      media_height: null,
      media_duration_ms: 42000,
    }),
    selectedVariantIndex: 0,
    variantCount: 1,
  });

  await expect(page.getByText('Narration pass')).toBeVisible();
  await expect(page.getByText('Audio', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Variants scope')).toContainText('Variant 1/1');
  await expect(page.getByLabel('Variants scope')).toContainText('Audio · Completed');
  await expect(page.getByText('Audio · Completed')).toBeVisible();
  await expect(page.getByText('42s')).toBeVisible();
  await expect(page.getByRole('button', { name: /asset scope details/i })).toHaveCount(0);
});

test('asset details dock keeps heavy details outside ForgeTray', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 720 });
  await mountComponent(page, 'AssetGenerationDock', {
    asset: asset(),
    assetTypeDisabled: false,
    onAssetTypeChange: '__record__:type',
    selectedVariant: fullVariant(),
    selectedVariantIndex: 0,
    variantCount: 3,
  });

  await expect(page.getByRole('region', { name: 'Asset generation controls' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Details scoped space summary', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /asset scope details/i })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Expanded asset details' })).toHaveCount(0);
  const dock = page.getByRole('region', { name: 'Asset generation controls' });
  await expect(dock).not.toContainText('Collection membership');
  await expect(dock).not.toContainText('Manual relations');
  await expect(page.getByRole('region', { name: 'Asset details inspector' })).toHaveCount(0);
  await expect(page.getByText('Collection membership')).toHaveCount(0);
  await expect(page.getByText('Manual relations')).toHaveCount(0);
  await expect(page.getByText('Composition usage')).toHaveCount(0);
  await expect(page.getByLabel('Prompt')).toBeVisible();
  const embeddedTray = page.locator('[class*="tray"]').first();
  await expect(embeddedTray).toHaveCSS('box-shadow', 'none');
  await expect(embeddedTray).toHaveCSS('border-radius', '8px');

  const detailsBeforePrompt = await page.evaluate(() => {
    const details = document.querySelector('[aria-label="Details scoped space summary"]');
    const prompt = document.querySelector('[aria-label="Prompt"]');
    return Boolean(details && prompt && details.compareDocumentPosition(prompt) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(detailsBeforePrompt).toBe(true);
  const dockGap = await page.evaluate(() => {
    const details = document.querySelector('[aria-label="Details scoped space summary"]');
    const prompt = document.querySelector('[aria-label="Prompt"]');
    if (!details || !prompt) return null;
    return prompt.getBoundingClientRect().top - details.getBoundingClientRect().bottom;
  });
  expect(dockGap).not.toBeNull();
  expect(dockGap!).toBeGreaterThanOrEqual(12);
  await expect.poll(() => visibleHeightInViewport(page.getByLabel('Prompt'))).toBeGreaterThanOrEqual(56);
  await expect.poll(() => visibleRatioInViewport(page.getByLabel('Prompt'))).toBeGreaterThanOrEqual(0.95);

  await screenshot(page, 'asset-details-summary-above-dock-desktop', { fullPage: true });
});

test('asset details closed mobile layout keeps the canvas stage in the primary row', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await mountComponent(page, 'AssetGenerationDockClosedCanvas', {});

  await expect(page.getByRole('region', { name: 'Asset details inspector' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Asset generation controls' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Details scoped space summary', exact: true })).toHaveCount(0);
  const geometry = await page.locator('[class*="canvasContainer"]').first().evaluate((container) => {
    const stage = container.querySelector('[class*="canvasStage"]');
    const dock = container.querySelector('[aria-label="Asset generation controls"]');
    const stageBox = stage?.getBoundingClientRect();
    const dockBox = dock?.getBoundingClientRect();
    return stageBox && dockBox
      ? {
          stageTop: stageBox.top,
          stageBottom: stageBox.bottom,
          dockTop: dockBox.top,
          dockBottom: dockBox.bottom,
          viewportHeight: window.innerHeight,
        }
      : null;
  });
  expect(geometry).not.toBeNull();
  expect(geometry!.stageTop).toBe(0);
  expect(geometry!.stageBottom).toBeLessThanOrEqual(geometry!.dockTop);
  expect(geometry!.stageBottom).toBeGreaterThan(geometry!.viewportHeight * 0.55);
  expect(geometry!.dockBottom).toBeLessThanOrEqual(geometry!.viewportHeight);
  await screenshot(page, 'asset-details-closed-mobile-layout', { fullPage: true });
});

test('asset variant inspector stays clear of the generation dock', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mountComponent(page, 'AssetGenerationDockWithVariantInspector', {});

  const inspector = page.getByRole('complementary', { name: 'Variant details' });
  const dock = page.getByRole('region', { name: 'Asset generation controls' });
  const tray = page.locator('[class*="tray"]').first();
  await expect(inspector).toBeVisible();
  await expect(dock).toBeVisible();
  await expect(tray).toBeVisible();
  await expect(page.getByRole('region', { name: 'Details scoped space summary', exact: true })).toHaveCount(0);
  await expectNoOverlap(inspector, tray);

  const geometry = await page.evaluate(() => {
    const stage = document.querySelector('[class*="canvasStage"]');
    const panel = document.querySelector('[aria-label="Variant details"]');
    const tray = document.querySelector('[class*="tray"]');
    const panelBox = panel?.getBoundingClientRect();
    const stageBox = stage?.getBoundingClientRect();
    const trayBox = tray?.getBoundingClientRect();
    return panelBox && stageBox && trayBox
      ? {
          panelLeft: panelBox.left,
          panelRight: panelBox.right,
          panelTop: panelBox.top,
          panelBottom: panelBox.bottom,
          panelWidth: panelBox.width,
          trayTop: trayBox.top,
          stageTop: stageBox.top,
          stageBottom: stageBox.bottom,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        }
      : null;
  });
  expect(geometry).not.toBeNull();
  expect(geometry!.panelLeft).toBeGreaterThanOrEqual(16);
  expect(geometry!.panelRight).toBeLessThanOrEqual(geometry!.viewportWidth - 16);
  expect(geometry!.panelTop).toBeGreaterThanOrEqual(geometry!.stageBottom);
  expect(geometry!.panelWidth).toBeLessThanOrEqual(720);
  expect(geometry!.panelBottom).toBeLessThanOrEqual(geometry!.trayTop - 12);
  expect(geometry!.stageTop).toBe(0);
  expect(geometry!.stageBottom).toBeGreaterThan(geometry!.viewportHeight * 0.45);

  await screenshot(page, 'asset-details-variant-inspector-clear-of-dock', { fullPage: true });
});

test('asset variant inspector stays clear of the generation dock on tablet widths', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 760 });
  await mountComponent(page, 'AssetGenerationDockWithVariantInspector', {});

  const inspector = page.getByRole('complementary', { name: 'Variant details' });
  const dock = page.getByRole('region', { name: 'Asset generation controls' });
  const tray = page.locator('[class*="tray"]').first();
  await expect(inspector).toBeVisible();
  await expect(dock).toBeVisible();
  await expect(tray).toBeVisible();
  await expect(page.getByRole('region', { name: 'Details scoped space summary', exact: true })).toHaveCount(0);
  await expectNoOverlap(inspector, tray);

  const geometry = await page.evaluate(() => {
    const stage = document.querySelector('[class*="canvasStage"]');
    const panel = document.querySelector('[aria-label="Variant details"]');
    const tray = document.querySelector('[class*="tray"]');
    const panelBox = panel?.getBoundingClientRect();
    const trayBox = tray?.getBoundingClientRect();
    const stageBox = stage?.getBoundingClientRect();
    return panelBox && trayBox && stageBox
      ? {
          panelLeft: panelBox.left,
          panelRight: panelBox.right,
          panelTop: panelBox.top,
          panelBottom: panelBox.bottom,
          panelWidth: panelBox.width,
          trayTop: trayBox.top,
          stageTop: stageBox.top,
          stageBottom: stageBox.bottom,
          viewportHeight: window.innerHeight,
          viewportWidth: window.innerWidth,
        }
      : null;
  });
  expect(geometry).not.toBeNull();
  expect(geometry!.panelLeft).toBeGreaterThanOrEqual(8);
  expect(geometry!.panelRight).toBeLessThanOrEqual(geometry!.viewportWidth - 8);
  expect(geometry!.panelTop).toBeGreaterThanOrEqual(geometry!.stageBottom);
  expect(geometry!.panelWidth).toBeLessThanOrEqual(768);
  expect(geometry!.panelBottom).toBeLessThanOrEqual(geometry!.trayTop - 8);
  expect(geometry!.stageTop).toBe(0);
  expect(geometry!.stageBottom).toBeGreaterThan(geometry!.viewportHeight * 0.4);

  await screenshot(page, 'asset-details-variant-inspector-tablet-clear-of-dock', { fullPage: true });
});

test('asset detail overlays use flat chrome', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 460 });
  await mountComponent(page, 'AssetDetailOverlayChrome', {});

  const toolbar = page.getByRole('toolbar', { name: 'Scoped asset canvas controls' });
  await expect(toolbar).not.toContainText('Details');
  await expect(toolbar).not.toContainText('Asset');
  await expect(toolbar).not.toContainText('2 variants');
  await expect(toolbar).toContainText('Crystal Gate with readable scoped title');
  await expect(toolbar).toHaveCSS('flex-wrap', 'nowrap');
  await expect(toolbar.locator('[class*="assetTitleSlot"]')).toHaveCSS('text-overflow', 'clip');
  await expect(page.getByRole('region', { name: 'Tile grid overlay' })).toHaveCSS('box-shadow', 'none');
  const generationJobs = page.getByRole('region', { name: 'Generation jobs' });
  await expect(generationJobs.locator('[class*="jobCard"]')).toHaveCSS('box-shadow', 'none');
  await expect(generationJobs.getByLabel('Generating job')).toBeVisible();
  await expect(generationJobs).toContainText('Generating');
  await expect(generationJobs).not.toContainText('Creating variant...');

  await screenshot(page, 'asset-detail-flat-overlays', { fullPage: true });
});
