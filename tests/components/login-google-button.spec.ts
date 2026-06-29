import { expect, test } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

test('google login action uses shared button styling', async ({ page }) => {
  await page.setViewportSize({ width: 520, height: 220 });
  await mountComponent(page, 'GoogleLoginButton', {
    onClick: '__record__:login',
  });

  const button = page.getByRole('button', { name: 'Sign in with Google' });
  await expect(button).toBeVisible();
  await screenshot(page, 'login-google-shared-button', { fullPage: true });
});
