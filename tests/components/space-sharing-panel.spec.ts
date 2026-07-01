import { expect, test } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

const createdAt = '2026-06-27T10:00:00.000Z';
const joinedAt = 1_782_558_000_000;

const ownerMember = {
  user_id: '1',
  role: 'owner',
  joined_at: joinedAt,
  user: { id: '1', email: 'owner@example.test', name: 'Owner User' },
};

const editorMember = {
  user_id: '2',
  role: 'editor',
  joined_at: joinedAt,
  user: { id: '2', email: 'editor@example.test', name: 'Edit Person' },
};

const viewerMember = {
  user_id: '3',
  role: 'viewer',
  joined_at: joinedAt,
  user: { id: '3', email: 'viewer@example.test', name: null },
};

const sharing = {
  success: true,
  members: [ownerMember, editorMember, viewerMember],
  pendingAccessRequests: [
    {
      id: 'request-1',
      space_id: 'space-1',
      requester_user_id: '4',
      requested_role: 'editor',
      status: 'pending',
      message: null,
      created_at: createdAt,
      updated_at: createdAt,
      resolved_at: null,
      resolved_by_user_id: null,
      requester: { id: '4', email: 'requester@example.test', name: 'Request Person' },
    },
  ],
  pendingInvitations: [
    {
      id: 'invitation-1',
      space_id: 'space-1',
      email: 'pending@example.test',
      normalized_email: 'pending@example.test',
      role: 'viewer',
      status: 'pending',
      invited_by_user_id: '1',
      accepted_by_user_id: null,
      created_at: createdAt,
      updated_at: createdAt,
      expires_at: '2026-07-04T10:00:00.000Z',
      resolved_at: null,
      invitedBy: { id: '1', email: 'owner@example.test', name: 'Owner User' },
      acceptedBy: null,
    },
  ],
};

async function selectDropdown(page: import('@playwright/test').Page, label: string, optionName: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: optionName, exact: true }).click();
}

test('owner sharing panel exposes request, invite, member, and invitation controls', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 760 });
  await mountComponent(page, 'SpaceSharingPanel', {
    currentUserRole: 'owner',
    sharing,
    onClose: '__record__:close',
    onInvite: '__record__:invite',
    onApproveRequest: '__record__:approve',
    onRejectRequest: '__record__:reject',
    onRevokeInvitation: '__record__:revokeInvitation',
    onChangeMemberRole: '__record__:changeRole',
    onRevokeMember: '__record__:revokeMember',
  });

  const panel = page.getByRole('dialog', { name: 'Space sharing' });
  await expect(panel).toHaveCSS('box-shadow', 'none');
  await expect(panel).toHaveCSS('border-top-width', '1px');
  const panelBox = await panel.boundingBox();
  expect(panelBox?.width).toBeLessThanOrEqual(640);
  await expect(page.getByText('Email')).toHaveCSS('text-transform', 'none');
  await expect(page.getByText('Email')).toHaveCSS('letter-spacing', 'normal');
  await expect(page.getByText('editor').first()).toHaveCSS('text-transform', 'none');
  await expect(page.getByRole('button', { name: 'Close sharing panel' })).toHaveCSS('width', '24px');
  await expect(page.getByRole('heading', { name: 'Incoming requests' })).toBeVisible();
  await expect(page.getByText('requester@example.test')).toBeVisible();
  await expect(page.getByText(/Requested Jun 27, 10:00 AM/)).toBeVisible();
  await expect(page.getByText('pending@example.test')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve viewer' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve viewer' })).toHaveCSS('min-height', '30px');
  const rows = panel.locator('[class*="row"]');
  await expect(rows.first()).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(rows.first()).toHaveCSS('border-left-width', '0px');
  await expect(rows.first()).toHaveCSS('border-radius', '0px');

  await page.getByLabel('Email').fill('new@example.test');
  await selectDropdown(page, 'Invite role', 'editor');
  await page.getByRole('button', { name: 'Send invite' }).click();
  await page.getByRole('button', { name: 'Approve viewer' }).click();
  await page.getByRole('button', { name: 'Reject' }).click();
  await selectDropdown(page, 'Change role for Edit Person', 'viewer');
  await screenshot(page, 'space-sharing-panel-flat-owner');
  await page.getByRole('button', { name: 'Revoke' }).first().click();
  await page
    .locator('section[aria-labelledby="sharing-invitations-heading"]')
    .getByRole('button', { name: 'Revoke' })
    .click();

  const calls = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(calls).toEqual(expect.arrayContaining([
    expect.objectContaining({ eventName: 'invite', args: ['new@example.test', 'editor'] }),
    expect.objectContaining({ eventName: 'approve', args: ['request-1', 'viewer'] }),
    expect.objectContaining({ eventName: 'reject', args: ['request-1'] }),
    expect.objectContaining({ eventName: 'changeRole', args: ['2', 'viewer'] }),
    expect.objectContaining({ eventName: 'revokeMember', args: ['2'] }),
    expect.objectContaining({ eventName: 'revokeInvitation', args: ['invitation-1'] }),
  ]));
});

test('non-owner sharing panel hides management controls', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 600 });
  await mountComponent(page, 'SpaceSharingPanel', {
    currentUserRole: 'editor',
    summaryMembers: [ownerMember, editorMember],
    onClose: '__record__:close',
    onInvite: '__record__:invite',
    onApproveRequest: '__record__:approve',
    onRejectRequest: '__record__:reject',
    onRevokeInvitation: '__record__:revokeInvitation',
    onChangeMemberRole: '__record__:changeRole',
    onRevokeMember: '__record__:revokeMember',
  });

  await expect(page.getByText('Only the owner can manage sharing settings.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Active members' })).toBeVisible();
  await expect(page.getByText('Owner User')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send invite' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Approve viewer' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reject' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Revoke' })).toHaveCount(0);
  await expect(page.getByLabel('Change role for Edit Person')).toHaveCount(0);
});
