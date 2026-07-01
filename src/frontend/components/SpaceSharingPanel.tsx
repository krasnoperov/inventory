import { useState, type FormEvent } from 'react';
import type {
  SpaceAccessRequestWithRequester,
  SpaceAccessRole,
  SpaceRole,
  SpaceSharingMember,
  SpaceSharingResponse,
} from '../../shared/api/schemas';
import { formatUtcDateTime } from '../lib/dates';
import { Button, IconButton, TextInput, UiSelect, type SelectOption } from '../ui';
import styles from './SpaceSharingPanel.module.css';

type InviteHandler = (email: string, role: SpaceAccessRole) => boolean | Promise<boolean>;
type ActionResult = void | boolean | Promise<void | boolean>;
type RequestHandler = (requestId: string, role: SpaceAccessRole) => ActionResult;
type IdHandler = (id: string) => ActionResult;
type MemberRoleHandler = (userId: string, role: SpaceAccessRole) => ActionResult;

interface SpaceSharingPanelProps {
  currentUserRole: SpaceRole;
  layout?: 'panel' | 'rail';
  sharing?: SpaceSharingResponse | null;
  summaryMembers?: SpaceSharingMember[];
  isLoading?: boolean;
  error?: string | null;
  actionError?: string | null;
  busyAction?: string | null;
  onClose: () => void;
  onInvite?: InviteHandler;
  onApproveRequest?: RequestHandler;
  onRejectRequest?: IdHandler;
  onRevokeInvitation?: IdHandler;
  onChangeMemberRole?: MemberRoleHandler;
  onRevokeMember?: IdHandler;
}

const roleOptions: SpaceAccessRole[] = ['viewer', 'editor'];
const ROLE_SELECT_OPTIONS: Array<SelectOption<SpaceAccessRole>> = roleOptions.map((role) => ({
  value: role,
  label: role,
}));

function displayName(user: { email: string; name: string | null }) {
  return user.name?.trim() || user.email;
}

function rowKey(prefix: string, id: string) {
  return `${prefix}:${id}`;
}

function formatOptionalDate(value: string | number | null | undefined) {
  return value == null ? null : formatUtcDateTime(value);
}

function RoleBadge({ role }: { role: SpaceRole | SpaceAccessRole }) {
  return (
    <span className={styles.roleBadge} data-role={role}>
      {role}
    </span>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function EmptyState({ children }: { children: string }) {
  return <p className={styles.empty}>{children}</p>;
}

function RequestActions({
  request,
  busyAction,
  onApproveRequest,
  onRejectRequest,
}: {
  request: SpaceAccessRequestWithRequester;
  busyAction?: string | null;
  onApproveRequest?: RequestHandler;
  onRejectRequest?: IdHandler;
}) {
  const viewerKey = rowKey('approve-viewer', request.id);
  const editorKey = rowKey('approve-editor', request.id);
  const rejectKey = rowKey('reject-request', request.id);

  return (
    <div className={styles.actions}>
      <Button
        className={styles.actionButton}
        disabled={Boolean(busyAction) || !onApproveRequest}
        onClick={() => void onApproveRequest?.(request.id, 'viewer')}
      >
        {busyAction === viewerKey ? 'Approving...' : 'Approve viewer'}
      </Button>
      <Button
        className={styles.actionButton}
        variant="primary"
        disabled={Boolean(busyAction) || !onApproveRequest}
        onClick={() => void onApproveRequest?.(request.id, 'editor')}
      >
        {busyAction === editorKey ? 'Approving...' : 'Approve editor'}
      </Button>
      <Button
        className={styles.actionButton}
        variant="danger"
        disabled={Boolean(busyAction) || !onRejectRequest}
        onClick={() => void onRejectRequest?.(request.id)}
      >
        {busyAction === rejectKey ? 'Rejecting...' : 'Reject'}
      </Button>
    </div>
  );
}

export function SpaceSharingPanel({
  currentUserRole,
  layout = 'panel',
  sharing,
  summaryMembers = sharing?.members ?? [],
  isLoading = false,
  error = null,
  actionError = null,
  busyAction = null,
  onClose,
  onInvite,
  onApproveRequest,
  onRejectRequest,
  onRevokeInvitation,
  onChangeMemberRole,
  onRevokeMember,
}: SpaceSharingPanelProps) {
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<SpaceAccessRole>('viewer');
  const isOwner = currentUserRole === 'owner';
  const members = sharing?.members ?? summaryMembers;
  const requests = sharing?.pendingAccessRequests ?? [];
  const invitations = sharing?.pendingInvitations ?? [];

  const handleInvite = async (event: FormEvent) => {
    event.preventDefault();
    const email = inviteEmail.trim();
    if (!email || !onInvite) return;
    const sent = await onInvite(email, inviteRole);
    if (sent !== false) {
      setInviteEmail('');
      setInviteRole('viewer');
    }
  };

  return (
    <aside className={`${styles.panel} ${layout === 'rail' ? styles.rail : ''}`} role={layout === 'rail' ? 'region' : 'dialog'} aria-label="Space sharing">
      <div className={styles.header}>
        <div className={styles.titleBlock}>
          <h2>Sharing</h2>
          <p className={styles.subtitle}>
            {isOwner ? 'Manage members, requests, and pending invitations.' : 'People with access to this space.'}
          </p>
        </div>
        <IconButton className={styles.closeButton} onClick={onClose} aria-label="Close sharing panel">
          <CloseIcon />
        </IconButton>
      </div>

      <div className={styles.content}>
        {!isOwner && (
          <p className={styles.notice}>Only the owner can manage sharing settings.</p>
        )}
        {error && <p className={styles.error}>{error}</p>}
        {actionError && <p className={styles.error}>{actionError}</p>}

        {isOwner && (
          <form className={styles.inviteForm} onSubmit={handleInvite}>
            <label className={styles.field}>
              <span className={styles.label}>Email</span>
              <TextInput
                type="email"
                value={inviteEmail}
                placeholder="teammate@example.com"
                disabled={Boolean(busyAction) || !onInvite}
                onChange={(event) => setInviteEmail(event.currentTarget.value)}
                fullWidth
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Role</span>
              <UiSelect
                className={styles.select}
                value={inviteRole}
                label="Invite role"
                options={ROLE_SELECT_OPTIONS}
                disabled={Boolean(busyAction) || !onInvite}
                onValueChange={setInviteRole}
                fullWidth
              />
            </label>
            <Button
              type="submit"
              className={styles.actionButton}
              variant="primary"
              disabled={Boolean(busyAction) || !inviteEmail.trim() || !onInvite}
            >
              {busyAction === 'invite' ? 'Sending...' : 'Send invite'}
            </Button>
          </form>
        )}

        {isLoading ? (
          <p className={styles.empty}>Loading sharing state...</p>
        ) : (
          <>
            {isOwner && (
              <section className={styles.section} aria-labelledby="sharing-requests-heading">
                <div className={styles.sectionHeader}>
                  <h3 id="sharing-requests-heading">Incoming requests</h3>
                  <span className={styles.count}>{requests.length}</span>
                </div>
                {requests.length === 0 ? (
                  <EmptyState>No pending requests.</EmptyState>
                ) : requests.map((request) => {
                  const created = formatOptionalDate(request.created_at);
                  return (
                    <div key={request.id} className={styles.row}>
                      <div className={styles.person}>
                        <span className={styles.primary}>{displayName(request.requester)}</span>
                        <span className={styles.secondary}>{request.requester.email}</span>
                      </div>
                      <div className={styles.meta}>
                        <RoleBadge role={request.requested_role} />
                        {created && <span className={styles.secondary}>Requested {created}</span>}
                      </div>
                      <RequestActions
                        request={request}
                        busyAction={busyAction}
                        onApproveRequest={onApproveRequest}
                        onRejectRequest={onRejectRequest}
                      />
                    </div>
                  );
                })}
              </section>
            )}

            <section className={styles.section} aria-labelledby="sharing-members-heading">
              <div className={styles.sectionHeader}>
                <h3 id="sharing-members-heading">Active members</h3>
                <span className={styles.count}>{members.length}</span>
              </div>
              {members.length === 0 ? (
                <EmptyState>No members to show.</EmptyState>
              ) : members.map((member) => {
                const joined = formatOptionalDate(member.joined_at);
                const isOwnerMember = member.role === 'owner';
                const busyRole = busyAction === rowKey('member-role', member.user_id);
                const busyRevoke = busyAction === rowKey('revoke-member', member.user_id);
                return (
                  <div key={member.user_id} className={styles.row}>
                    <div className={styles.person}>
                      <span className={styles.primary}>{displayName(member.user)}</span>
                      <span className={styles.secondary}>{member.user.email}</span>
                    </div>
                    <div className={styles.meta}>
                      {isOwner && !isOwnerMember ? (
                        <UiSelect
                          className={styles.select}
                          value={member.role as SpaceAccessRole}
                          label={`Change role for ${displayName(member.user)}`}
                          options={ROLE_SELECT_OPTIONS}
                          disabled={Boolean(busyAction) || !onChangeMemberRole}
                          onValueChange={(role) => void onChangeMemberRole?.(member.user_id, role)}
                          fullWidth
                        />
                      ) : (
                        <RoleBadge role={member.role} />
                      )}
                      {joined && <span className={styles.secondary}>Joined {joined}</span>}
                    </div>
                    <div className={styles.actions}>
                      {isOwner && !isOwnerMember ? (
                        <Button
                          className={styles.actionButton}
                          variant="danger"
                          disabled={Boolean(busyAction) || !onRevokeMember}
                          onClick={() => void onRevokeMember?.(member.user_id)}
                        >
                          {busyRevoke ? 'Revoking...' : busyRole ? 'Updating...' : 'Revoke'}
                        </Button>
                      ) : (
                        null
                      )}
                    </div>
                  </div>
                );
              })}
            </section>

            {isOwner && (
              <section className={styles.section} aria-labelledby="sharing-invitations-heading">
                <div className={styles.sectionHeader}>
                  <h3 id="sharing-invitations-heading">Pending invitations</h3>
                  <span className={styles.count}>{invitations.length}</span>
                </div>
                {invitations.length === 0 ? (
                  <EmptyState>No pending invitations.</EmptyState>
                ) : invitations.map((invitation) => {
                  const created = formatOptionalDate(invitation.created_at);
                  const expires = formatOptionalDate(invitation.expires_at);
                  const invitedBy = invitation.invitedBy ? displayName(invitation.invitedBy) : 'Unknown';
                  const busyRevoke = busyAction === rowKey('revoke-invitation', invitation.id);
                  return (
                    <div key={invitation.id} className={styles.row}>
                      <div className={styles.person}>
                        <span className={styles.primary}>{invitation.email}</span>
                        <span className={styles.secondary}>Invited by {invitedBy}</span>
                      </div>
                      <div className={styles.meta}>
                        <RoleBadge role={invitation.role} />
                        {created && <span className={styles.secondary}>Created {created}</span>}
                        {expires && <span className={styles.secondary}>Expires {expires}</span>}
                      </div>
                      <div className={styles.actions}>
                        <Button
                          className={styles.actionButton}
                          variant="danger"
                          disabled={Boolean(busyAction) || !onRevokeInvitation}
                          onClick={() => void onRevokeInvitation?.(invitation.id)}
                        >
                          {busyRevoke ? 'Revoking...' : 'Revoke'}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </section>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
