import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HeaderNav } from '../components/HeaderNav';
import { Link } from '../components/Link';
import { UsageIndicator } from '../components/UsageIndicator';
import { WorkspaceChrome } from '../components/WorkspaceChrome';
import { useAuth } from '../contexts/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { Button, ButtonLink } from '../ui';
import UnknownPage from './UnknownPage';
import {
  cancelMySpaceAccessRequest,
  createSpaceAccessRequest,
  spaceAccessQueryOptions,
} from '../queries';
import { ApiFetchError } from '../../api/client';
import type { SpaceAccessRequest, SpaceAccessState } from '../../api/types';
import styles from './SpaceAccessRequestPage.module.css';

interface SpaceAccessRequestViewProps {
  access: SpaceAccessState;
  userName?: string | null;
  userEmail?: string | null;
  isRequesting?: boolean;
  isCanceling?: boolean;
  error?: string | null;
  canceledRequest?: SpaceAccessRequest | null;
  onRequest?: () => void;
  onCancel?: () => void;
}

export function SpaceAccessRequestView({
  access,
  userName,
  userEmail,
  isRequesting = false,
  isCanceling = false,
  error = null,
  canceledRequest = null,
  onRequest,
  onCancel,
}: SpaceAccessRequestViewProps) {
  const isPending = access.status === 'pending_request';
  const isInvited = access.status === 'pending_invitation';
  const wasCanceled = access.status === 'none' && Boolean(canceledRequest);

  const statusLabel = isPending
    ? 'Request pending'
    : wasCanceled
      ? 'Request canceled'
      : isInvited
        ? 'Invitation pending'
        : 'Private Space';
  const title = isPending
    ? 'Your access request was sent'
    : wasCanceled
      ? 'Your request was canceled'
      : 'This Space is private';
  const copy = isPending
    ? 'A Space owner can approve your request. You can safely leave this page and come back later.'
    : wasCanceled
      ? 'You can send a new request if you still need access to this Space.'
      : isInvited
        ? 'You have a pending invitation for this Space. Request access here if you still cannot open it.'
        : 'Ask to join this Space with the signed-in account below. Space contents are hidden until you are approved.';

  return (
    <main className={styles.main}>
      <section className={styles.panel} aria-labelledby="space-access-title">
        <div className={styles.statusRow}>
          <span className={`${styles.statusPill} ${isPending || isInvited ? styles.statusPillPending : ''}`}>
            {statusLabel}
          </span>
        </div>

        <div>
          <h1 id="space-access-title" className={styles.title}>{title}</h1>
          <p className={styles.copy}>{copy}</p>
        </div>

        <div className={styles.identity}>
          <span className={styles.identityLabel}>Requesting as</span>
          {userName && <span className={styles.identityName}>{userName}</span>}
          <span className={styles.identityEmail}>{userEmail || 'Signed-in account'}</span>
        </div>

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.actions}>
          {isPending ? (
            <Button
              className={styles.actionButton}
              variant="secondary"
              onClick={() => onCancel?.()}
              disabled={isCanceling}
            >
              {isCanceling ? 'Canceling...' : 'Cancel request'}
            </Button>
          ) : (
            <Button
              className={styles.actionButton}
              variant="primary"
              onClick={() => onRequest?.()}
              disabled={isRequesting}
            >
              {isRequesting ? 'Sending...' : wasCanceled ? 'Request again' : 'Request access'}
            </Button>
          )}
          <ButtonLink to="/dashboard" className={styles.actionButton}>
            Back to dashboard
          </ButtonLink>
        </div>
      </section>
    </main>
  );
}

export default function SpaceAccessRequestPage({ spaceId }: { spaceId: string }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [canceledRequest, setCanceledRequest] = useState<SpaceAccessRequest | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  useDocumentTitle('Request Space access');

  const accessQuery = useQuery(spaceAccessQueryOptions(spaceId));
  const access = accessQuery.data?.access;

  const requestMutation = useMutation({
    mutationFn: () => createSpaceAccessRequest(spaceId, 'viewer'),
    onSuccess: (data) => {
      setMutationError(null);
      setCanceledRequest(null);
      queryClient.setQueryData(spaceAccessQueryOptions(spaceId).queryKey, {
        success: true,
        access: {
          status: 'pending_request',
          member: null,
          pendingRequest: data.request,
          pendingInvitation: null,
        },
      });
    },
    onError: (error) => {
      setMutationError(error instanceof Error ? error.message : 'Failed to send request');
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelMySpaceAccessRequest(spaceId),
    onSuccess: (data) => {
      setMutationError(null);
      setCanceledRequest(data.request);
      queryClient.setQueryData(spaceAccessQueryOptions(spaceId).queryKey, {
        success: true,
        access: {
          status: 'none',
          member: null,
          pendingRequest: null,
          pendingInvitation: null,
        },
      });
    },
    onError: (error) => {
      setMutationError(error instanceof Error ? error.message : 'Failed to cancel request');
    },
  });

  const headerRightSlot = user ? (
    <HeaderNav userName={user.name} userEmail={user.email} />
  ) : (
    <ButtonLink to="/login" className={styles.headerAction}>Sign in</ButtonLink>
  );

  const fallbackAccess = useMemo<SpaceAccessState>(() => ({
    status: 'none',
    member: null,
    pendingRequest: null,
    pendingInvitation: null,
  }), []);

  if (accessQuery.error instanceof ApiFetchError && accessQuery.error.status === 404) {
    return <UnknownPage />;
  }

  return (
    <div className={styles.page}>
      <WorkspaceChrome
        leftSlot={<Link to="/dashboard" className={styles.brand}>Make Effects</Link>}
        rightSlot={headerRightSlot}
        statusSlot={<UsageIndicator />}
        isLoading={accessQuery.isFetching}
      />
      <SpaceAccessRequestView
        access={access ?? fallbackAccess}
        userName={user?.name}
        userEmail={user?.email}
        canceledRequest={canceledRequest}
        isRequesting={requestMutation.isPending}
        isCanceling={cancelMutation.isPending}
        error={
          mutationError ??
          (accessQuery.error instanceof Error ? accessQuery.error.message : null)
        }
        onRequest={() => requestMutation.mutate()}
        onCancel={() => cancelMutation.mutate()}
      />
    </div>
  );
}
