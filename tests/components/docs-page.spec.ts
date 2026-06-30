import { expect, test, type Page } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

async function resolvedColor(page: Page, value: string) {
  return page.evaluate((colorValue) => {
    const probe = document.createElement('div');
    probe.style.color = colorValue;
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return resolved;
  }, value);
}

test('docs page uses quiet tokenized app chrome', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mountComponent(page, 'DocsPage', { slug: 'quickstart' });

  await expect(page.getByRole('heading', { name: 'Keep the thread of your media project.' })).toBeVisible();
  await expect(page.locator('aside[aria-label="Docs navigation"]')).toBeVisible();

  const pageShell = page.locator('[data-testid="harness-root"] > div');
  await expect(pageShell).toHaveCSS('background-color', await resolvedColor(page, 'var(--color-bg)'));

  const article = page.locator('article');
  await expect(article).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(article).toHaveCSS('box-shadow', 'none');

  const title = page.getByRole('heading', { name: 'Keep the thread of your media project.' });
  await expect(title).toHaveCSS('font-size', '32px');
  await expect(title).toHaveCSS('letter-spacing', 'normal');

  const firstCodeBlock = page.locator('pre').first();
  if (await firstCodeBlock.count() > 0) {
    await expect(firstCodeBlock).toHaveCSS('background-color', await resolvedColor(page, 'var(--color-surface)'));
    await expect(firstCodeBlock).toHaveCSS('color', await resolvedColor(page, 'var(--color-text)'));
  }

  await screenshot(page, 'docs-page-tokenized-chrome', { fullPage: true });
});
