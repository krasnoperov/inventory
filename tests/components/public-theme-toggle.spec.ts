import { expect, test } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

test('public theme toggle uses shared button chrome', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 180 });
  await mountComponent(page, 'PublicThemeToggle', {
    scheme: 'dark',
    onToggle: '__record__:toggle',
  });

  const toggle = page.getByRole('button', { name: 'Toggle theme' });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveText(/Light/);
  await expect(toggle).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(toggle).toBeEnabled();
  await screenshot(page, 'public-theme-toggle', { fullPage: true });
});
