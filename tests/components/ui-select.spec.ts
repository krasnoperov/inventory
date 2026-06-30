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

test('shared select uses tokenized trigger and popup chrome', async ({ page }) => {
  await page.setViewportSize({ width: 520, height: 360 });
  await mountComponent(page, 'UiSelect', {});

  const trigger = page.getByRole('combobox', { name: 'Preview media type' });
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveCSS('border-radius', '8px');

  await trigger.focus();
  await expect(trigger).toHaveCSS('box-shadow', await resolvedShadow(page, 'var(--focus-ring)'));

  await trigger.click();
  const popup = page.locator('[class*="popup"]').first();
  await expect(popup).toBeVisible();
  await expect(popup).toHaveCSS('border-radius', '8px');
  await expect(popup).toHaveCSS('box-shadow', await resolvedShadow(page, 'var(--shadow-header)'));
  await expect(page.getByRole('option', { name: 'Video' })).toHaveCSS('font-size', '12px');

  await screenshot(page, 'ui-select-tokenized-popup', { fullPage: true });
});
