import { expect, test } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

test('authorization approval actions use shared button styling', async ({ page }) => {
  await page.setViewportSize({ width: 520, height: 180 });
  await mountComponent(page, 'AuthorizationDecisionActions', {
    submitting: false,
    onDecision: '__record__:decision',
  });

  await expect(page.getByRole('button', { name: 'Deny' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Grant Access' })).toBeVisible();
  await screenshot(page, 'authorization-decision-actions', { fullPage: true });
});
