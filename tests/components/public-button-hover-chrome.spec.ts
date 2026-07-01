import { expect, test } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

test('shared form action button hover stays flat', async ({ page }) => {
  await page.setViewportSize({ width: 560, height: 430 });
  await mountComponent(page, 'FormContainerPreview', {});

  await expect(page.getByRole('button', { name: 'Legacy submit' })).toHaveCount(0);

  const action = page.getByRole('button', { name: 'Continue' });
  await action.hover();
  await expect(action).toHaveCSS('transform', 'none');
  await expect(action).toHaveCSS('box-shadow', 'none');

  await screenshot(page, 'form-submit-flat-hover-chrome', { fullPage: true });
});

test('public sign-in buttons do not lift on hover', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 720 });

  await mountComponent(page, 'DocsPage', { slug: 'quickstart' });
  const docsSignIn = page.getByRole('link', { name: 'Sign In' });
  await docsSignIn.hover();
  await expect(docsSignIn).toHaveCSS('transform', 'none');
  await expect(docsSignIn).toHaveCSS('box-shadow', 'none');
  await screenshot(page, 'docs-sign-in-flat-hover-chrome', { fullPage: true });

  await mountComponent(page, 'ProfileSignInButton', {});
  const profileSignIn = page.getByRole('link', { name: 'Sign In' });
  await profileSignIn.hover();
  await expect(profileSignIn).toHaveCSS('transform', 'none');
  await expect(profileSignIn).toHaveCSS('box-shadow', 'none');
  await screenshot(page, 'profile-sign-in-flat-hover-chrome', { fullPage: true });
});

test('pricing page ctas do not lift on hover', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mountComponent(page, 'PricingPage', {});

  for (const ctaName of ['Sign in', 'Start with Google', 'Read the quickstart', 'Start managed AI', 'Set up BYOK']) {
    const cta = page.getByRole('link', { name: ctaName }).first();
    await cta.hover();
    await expect(cta).toHaveCSS('transform', 'none');
    await expect(cta).toHaveCSS('box-shadow', 'none');
  }

  await page.evaluate(() => window.scrollTo(0, 0));
  await screenshot(page, 'pricing-cta-flat-hover-chrome', { fullPage: true });
});
