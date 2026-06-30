import { expect, test, type Page } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

async function resolvedShadow(page: Page, value: string) {
  return page.evaluate((shadowValue) => {
    const probe = document.createElement('div');
    probe.style.boxShadow = shadowValue;
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).boxShadow;
    probe.remove();
    return resolved;
  }, value);
}

test('shared button uses tokenized focus and small control chrome', async ({ page }) => {
  await page.setViewportSize({ width: 560, height: 260 });
  await mountComponent(page, 'UiButton', {});

  const primary = page.getByRole('button', { name: 'Primary' });
  await primary.focus();
  await expect(primary).toHaveCSS('box-shadow', await resolvedShadow(page, 'var(--focus-ring)'));

  const small = page.getByRole('button', { name: 'Ghost small' });
  await expect(small).toHaveCSS('font-size', '12px');

  const icon = page.getByRole('button', { name: 'Preview icon action' });
  await expect(icon).toHaveCSS('width', await icon.evaluate((node) => getComputedStyle(node).minHeight));
  await expect(icon).toHaveCSS('aspect-ratio', '1 / 1');

  await screenshot(page, 'ui-button-tokenized-focus', { fullPage: true });
});
