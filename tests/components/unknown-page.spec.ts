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

async function resolvedBackground(page: import('@playwright/test').Page, value: string) {
  return page.evaluate((colorValue) => {
    const probe = document.createElement('div');
    probe.style.backgroundColor = colorValue;
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return resolved;
  }, value);
}

test('unknown page uses tokenized chrome surfaces', async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 520 });
  await mountComponent(page, 'UnknownPage', {});

  await expect(page.getByRole('heading', { name: '404' })).toBeVisible();
  const home = page.getByRole('link', { name: 'Back to home' });
  await expect(home).toHaveCSS(
    'color',
    await resolvedColor(page, 'var(--button-primary-text)'),
  );
  await expect(home).toHaveCSS(
    'background-color',
    await resolvedBackground(page, 'var(--button-primary-bg)'),
  );
  await expect(home).toHaveCSS('min-height', '34px');
  const card = page.locator('[class*="card"]');
  await expect(card).toHaveCSS('box-shadow', 'none');
  await expect(card).toHaveCSS('border-top-width', '1px');

  await screenshot(page, 'unknown-page-flat-card-chrome', { fullPage: true });
});
