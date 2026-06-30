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

test('app header uses the shared header elevation token', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 160 });
  await mountComponent(page, 'AppHeaderPreview', {});

  const header = page.locator('nav').first();
  await expect(header).toBeVisible();
  await expect(header).toHaveCSS('box-shadow', await resolvedShadow(page, 'var(--shadow-header)'));
  const brandBox = await page.getByText('MakeFX').boundingBox();
  const titleBox = await page.getByText('Crystal Gate').boundingBox();
  expect(brandBox).not.toBeNull();
  expect(titleBox).not.toBeNull();
  if (!brandBox || !titleBox) {
    throw new Error('header slot bounds missing');
  }
  expect(titleBox.x - (brandBox.x + brandBox.width)).toBeGreaterThanOrEqual(8);
  await screenshot(page, 'app-header-shadow-token', { fullPage: true });
});
