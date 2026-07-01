import { expect, test } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

test('space page overlay chrome stays flat', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 720 });
  await mountComponent(page, 'SpacePageOverlayChrome', {});

  const toolbar = page.getByRole('toolbar', { name: 'Space controls' });
  await expect(toolbar).toBeVisible();
  await expect(toolbar.locator('[class*="spaceTitle"]')).toHaveCSS('white-space', 'normal');
  await expect(toolbar.locator('[class*="spaceTitle"]')).toHaveCSS('text-overflow', 'clip');
  await expect(toolbar).toContainText('Cinematic Marketplace Space With Readable Production Asset Names');
  const firstJobCard = page.locator('[class*="jobCard"]').first();
  await expect(firstJobCard).toBeVisible();
  await expect(firstJobCard).toHaveCSS('box-shadow', 'none');
  await expect(firstJobCard).toHaveCSS('transform', 'none');
  await expect(firstJobCard).not.toHaveCSS('animation-name', /slideIn/);
  await expect(page.getByLabel('Generating job')).toBeVisible();
  await expect(page.getByLabel('Done job')).toBeVisible();
  await expect(firstJobCard).not.toContainText('↻');
  await expect(page.locator('[class*="jobCard"]').nth(1)).not.toContainText('✓');
  await expect(firstJobCard.locator('[class*="jobAssetName"]')).toHaveCSS('white-space', 'normal');
  await expect(firstJobCard.locator('[class*="jobAssetName"]')).toHaveCSS('text-overflow', 'clip');
  await expect(firstJobCard.locator('[class*="jobPrompt"]')).toHaveCSS('white-space', 'normal');
  await expect(firstJobCard.locator('[class*="jobPrompt"]')).toHaveCSS('text-overflow', 'clip');
  const overlayDoesNotOverflow = await page.locator('[class*="jobsOverlay"]').evaluate((node) => (
    node.scrollWidth <= node.clientWidth
  ));
  expect(overlayDoesNotOverflow).toBe(true);

  await screenshot(page, 'space-page-flat-overlay-chrome', { fullPage: true });
});

test('space page overlay chrome keeps long labels readable on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 720 });
  await mountComponent(page, 'SpacePageOverlayChrome', {});

  const toolbar = page.getByRole('toolbar', { name: 'Space controls' });
  await expect(toolbar.locator('[class*="spaceTitle"]')).toHaveCSS('white-space', 'normal');
  await expect(toolbar.locator('[class*="spaceTitle"]')).toHaveCSS('text-overflow', 'clip');
  await expect(page.getByText('Crystal Gate With Very Long Readable Generation Name')).toBeVisible();
  await expect(page.getByText('"clean asset detail chrome without hiding important production wording"')).toBeVisible();

  const rootDoesNotOverflow = await page.locator('[data-testid="harness-root"]').evaluate((node) => (
    node.scrollWidth <= node.clientWidth
  ));
  expect(rootDoesNotOverflow).toBe(true);

  await screenshot(page, 'space-page-readable-overlay-mobile', { fullPage: true });
});

test('space page composition details dock beside the canvas instead of covering it', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 760 });
  await mountComponent(page, 'SpacePageOverlayChrome', { showCompositionRail: true });

  const workspace = page.locator('[class*="canvasWorkspaceWithInspector"]');
  const stage = page.locator('[class*="canvasStage"]');
  const rail = page.locator('[class*="compositionPanelContainer"]');
  await expect(workspace).toHaveCSS('display', 'grid');
  await expect(rail).not.toHaveCSS('position', 'absolute');
  await expect(page.getByRole('complementary', { name: 'Composition detail' })).toBeVisible();

  const [stageBox, railBox] = await Promise.all([stage.boundingBox(), rail.boundingBox()]);
  expect(stageBox).not.toBeNull();
  expect(railBox).not.toBeNull();
  expect(stageBox!.x + stageBox!.width).toBeLessThanOrEqual(railBox!.x + 1);

  await screenshot(page, 'space-page-composition-detail-rail', { fullPage: true });
});
