import { expect, test } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

async function resolvedColor(page: import('@playwright/test').Page, value: string) {
  return page.evaluate((colorValue) => {
    const probe = document.createElement('div');
    probe.style.color = colorValue;
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return resolved;
  }, value);
}

test('canvas toolbar controls use shared button primitives', async ({ page }) => {
  await page.setViewportSize({ width: 520, height: 140 });
  await mountComponent(page, 'CanvasToolbarControls', {
    onAction: '__record__:toolbar-action',
  });

  await expect(page.getByRole('toolbar', { name: 'Toolbar preview' })).toBeVisible();
  await expect(page.getByRole('toolbar', { name: 'Toolbar preview' })).toHaveCSS('box-shadow', 'none');
  await expect(page.getByRole('toolbar', { name: 'Toolbar preview' })).toHaveCSS('border-top-width', '1px');
  await expect(page.getByRole('button', { name: 'Board view' })).toBeVisible();
  const activeControl = page.getByRole('button', { name: 'Relations view' });
  await expect(activeControl).toBeVisible();
  await expect(activeControl).toHaveCSS('border-color', await resolvedColor(page, 'var(--color-primary)'));
  await expect(page.getByRole('link', { name: 'Back to space' })).toBeVisible();
  await screenshot(page, 'canvas-toolbar-shared-buttons', { fullPage: true });
});
