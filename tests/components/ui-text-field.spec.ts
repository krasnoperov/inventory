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

test('shared text fields use tokenized control chrome', async ({ page }) => {
  await page.setViewportSize({ width: 520, height: 360 });
  await mountComponent(page, 'UiTextField', {});

  const input = page.getByRole('textbox', { name: 'Preview text input' });
  await expect(input).toHaveCSS('border-radius', '8px');
  await expect(input).toHaveCSS('font-size', '13px');

  await input.focus();
  await expect(input).toHaveCSS('box-shadow', await resolvedShadow(page, 'var(--focus-ring)'));

  const textarea = page.getByRole('textbox', { name: 'Preview text area' });
  await expect(textarea).toHaveCSS('border-radius', '8px');
  await expect(textarea).toHaveCSS('font-size', '13px');

  const disabled = page.getByRole('textbox', { name: 'Disabled text input' });
  await expect(disabled).toBeDisabled();
  await expect(disabled).toHaveCSS('opacity', '0.5');

  await screenshot(page, 'ui-text-field-tokenized-chrome', { fullPage: true });
});
