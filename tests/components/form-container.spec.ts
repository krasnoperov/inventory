import { expect, test } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

test('shared form container uses flat chrome', async ({ page }) => {
  await page.setViewportSize({ width: 560, height: 360 });
  await mountComponent(page, 'FormContainerPreview', {});

  const formContainer = page.locator('[class*="formContainer"]').first();
  await expect(formContainer).toHaveCSS('box-shadow', 'none');
  await expect(formContainer).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(formContainer).toHaveCSS('border-top-width', '1px');
  await expect(page.getByRole('textbox', { name: 'Project name' })).toHaveCSS('border-radius', '8px');
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();

  await screenshot(page, 'form-container-flat-chrome', { fullPage: true });
});
