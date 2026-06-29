import { expect, test } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

const provider = {
  provider: 'google_ai',
  label: 'Google AI',
  configured: true,
  platformConfigured: false,
  keyHint: 'sk-...9abc',
  updatedAt: '2026-06-29T10:00:00.000Z',
};

test('profile and billing actions use shared buttons', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 760 });
  await mountComponent(page, 'ProfileBillingActions', {
    provider,
    draft: 'new-api-key',
    isSaving: false,
    isDeleting: false,
    onDraftChange: '__record__:draft',
    onSave: '__record__:saveProvider',
    onDelete: '__record__:deleteProvider',
    canManagePlan: true,
    canStartPlan: true,
    isOpeningPortal: false,
    isStartingCheckout: false,
    onManageBilling: '__record__:manageBilling',
    onUpgrade: '__record__:upgrade',
    planDisplayName: 'Pro',
    canDeleteAccount: true,
    deleteAcknowledged: true,
    deleteEmail: 'owner@example.test',
    deleteError: null,
    isDeletingAccount: false,
    onAcknowledgedChange: '__record__:acknowledgeDelete',
    onDeleteAccount: '__record__:deleteAccount',
    onDeleteEmailChange: '__record__:deleteEmail',
    profileEmail: 'owner@example.test',
  });

  await expect(page.getByText('Google AI')).toBeVisible();
  await page.getByLabel('Google AI API key').fill('rotated-key');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.getByRole('button', { name: 'Manage plan', exact: true }).click();
  await page.getByRole('button', { name: 'Start Pro', exact: true }).click();
  await page.getByRole('button', { name: 'Delete account permanently', exact: true }).click();

  await screenshot(page, 'profile-billing-actions', { fullPage: true });

  const calls = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(calls).toEqual(expect.arrayContaining([
    expect.objectContaining({ eventName: 'draft', args: ['rotated-key'] }),
    expect.objectContaining({ eventName: 'saveProvider', args: [] }),
    expect.objectContaining({ eventName: 'deleteProvider', args: [] }),
    expect.objectContaining({ eventName: 'manageBilling', args: [] }),
    expect.objectContaining({ eventName: 'upgrade', args: [] }),
    expect.objectContaining({ eventName: 'deleteAccount', args: [] }),
  ]));
});
