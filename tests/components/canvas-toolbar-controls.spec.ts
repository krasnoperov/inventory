import { expect, test, type Page } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

async function resolvedShadow(page: Page, value: string) {
  return page.evaluate((shadow) => {
    const probe = document.createElement('div');
    probe.style.boxShadow = shadow;
    document.body.appendChild(probe);
    const computed = getComputedStyle(probe).boxShadow;
    probe.remove();
    return computed;
  }, value);
}

test('canvas toolbar controls use shared button primitives', async ({ page }) => {
  await page.setViewportSize({ width: 520, height: 140 });
  await mountComponent(page, 'CanvasToolbarControls', {
    onAction: '__record__:toolbar-action',
  });

  await expect(page.getByRole('toolbar', { name: 'Toolbar preview' })).toBeVisible();
  await expect(page.getByRole('toolbar', { name: 'Toolbar preview' })).toHaveCSS(
    'box-shadow',
    await resolvedShadow(page, 'var(--shadow-header)'),
  );
  await expect(page.getByRole('button', { name: 'Board view' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Relations view' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to space' })).toBeVisible();
  await screenshot(page, 'canvas-toolbar-shared-buttons', { fullPage: true });
});
