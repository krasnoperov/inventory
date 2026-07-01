import { expect, test } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

test('canvas drop hints distinguish Space assets from Details variants', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 320 });
  await mountComponent(page, 'CanvasDropHint', {});

  const spaceTarget = page.getByRole('region', { name: 'Space drop target preview' });
  const detailsTarget = page.getByRole('region', { name: 'Details drop target preview' });

  await expect(spaceTarget.getByRole('status')).toContainText('Space');
  await expect(spaceTarget.getByRole('status')).toContainText('New asset');
  await expect(spaceTarget.getByRole('status')).toContainText('Drop a media file onto the canvas');
  await expect(detailsTarget.getByRole('status')).toContainText('Details');
  await expect(detailsTarget.getByRole('status')).toContainText('New variant');
  await expect(detailsTarget.getByRole('status')).toContainText('Crystal Gate');

  await expect(spaceTarget.getByRole('status')).toHaveCSS('pointer-events', 'none');
  await expect(spaceTarget.getByRole('status')).toHaveCSS('box-shadow', 'none');
  await expect(detailsTarget.getByRole('status')).toHaveCSS('box-shadow', 'none');
  await screenshot(page, 'canvas-drop-hints-space-details', { fullPage: true });
});

test('canvas drop hints stay compact on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 360 });
  await mountComponent(page, 'CanvasDropHint', {});

  await expect(page.getByRole('region', { name: 'Space drop target preview' }).getByText('New asset')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Details drop target preview' }).getByText('New variant')).toBeVisible();
  await expect(page.getByText('Drop a media file onto the canvas')).toBeHidden();
  await screenshot(page, 'canvas-drop-hints-mobile', { fullPage: true });
});
