import { expect, test } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

const baseAccess = {
  member: null,
  pendingRequest: null,
  pendingInvitation: null,
};

test('private Space access view lets a signed-in non-member request access', async ({ page }) => {
  await page.setViewportSize({ width: 560, height: 520 });
  await mountComponent(page, 'SpaceAccessRequestView', {
    access: { ...baseAccess, status: 'none' },
    userName: 'Rina Maker',
    userEmail: 'rina@example.com',
    onRequest: '__record__:request',
    onCancel: '__record__:cancel',
  });

  await expect(page.getByRole('heading', { name: 'This Space is private' })).toBeVisible();
  await expect(page.getByText('rina@example.com')).toBeVisible();
  await expect(page.locator('[class*="identity"]').first()).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.getByRole('button', { name: 'Request access' })).toBeVisible();

  await page.getByRole('button', { name: 'Request access' }).click();
  await expect.poll(() => page.evaluate(() => window.__componentHarnessCalls)).toContain('request');
  await screenshot(page, 'space-access-request');
});

test('private Space access view shows an existing pending request', async ({ page }) => {
  await mountComponent(page, 'SpaceAccessRequestView', {
    access: {
      ...baseAccess,
      status: 'pending_request',
      pendingRequest: {
        id: 'request-1',
        space_id: 'space-1',
        requester_user_id: '2',
        requested_role: 'viewer',
        status: 'pending',
        message: null,
        created_at: 1,
        updated_at: 1,
        resolved_at: null,
        resolved_by_user_id: null,
      },
    },
    userEmail: 'rina@example.com',
    onCancel: '__record__:cancel',
  });

  await expect(page.getByText('Request pending')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your access request was sent' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel request' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Request access' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Cancel request' }).click();
  await expect.poll(() => page.evaluate(() => window.__componentHarnessCalls)).toContain('cancel');
});

test('private Space access view can re-request after cancellation', async ({ page }) => {
  await mountComponent(page, 'SpaceAccessRequestView', {
    access: { ...baseAccess, status: 'none' },
    canceledRequest: {
      id: 'request-1',
      space_id: 'space-1',
      requester_user_id: '2',
      requested_role: 'viewer',
      status: 'canceled',
      message: null,
      created_at: 1,
      updated_at: 2,
      resolved_at: 2,
      resolved_by_user_id: '2',
    },
    userEmail: 'rina@example.com',
    onRequest: '__record__:request',
  });

  await expect(page.getByText('Request canceled')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your request was canceled' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Request again' })).toBeVisible();
});
