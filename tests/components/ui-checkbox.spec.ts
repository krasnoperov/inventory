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

test('shared checkbox uses tokenized focus chrome', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 260 });
  await mountComponent(page, 'UiCheckbox', {});

  const checked = page.getByRole('checkbox', { name: 'Checked preview', exact: true });
  await expect(checked).toBeChecked();
  await checked.focus();
  await expect(checked).toHaveCSS('box-shadow', await resolvedShadow(page, 'var(--focus-ring)'));

  const unchecked = page.getByRole('checkbox', { name: 'Unchecked preview', exact: true });
  await expect(unchecked).not.toBeChecked();

  const disabled = page.getByRole('checkbox', { name: 'Disabled preview', exact: true });
  await expect(disabled).toBeDisabled();
  await expect(disabled).toHaveCSS('opacity', '0.5');

  await screenshot(page, 'ui-checkbox-tokenized-focus', { fullPage: true });
});
