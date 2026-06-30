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

test('workspace chrome uses the shared header elevation token', async ({ page }) => {
  await page.setViewportSize({ width: 860, height: 180 });
  await mountComponent(page, 'WorkspaceChromePreview', {});

  const chrome = page.locator('header').first();
  await expect(page.getByRole('navigation', { name: 'Workspace navigation' })).toBeVisible();
  await expect(chrome).toHaveCSS('box-shadow', await resolvedShadow(page, 'var(--shadow-header)'));
  await screenshot(page, 'workspace-chrome-shadow-token', { fullPage: true });
});
