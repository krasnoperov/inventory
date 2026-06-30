import { useEffect, useState } from 'react';
import { Link } from '../components/Link';
import { useNavigate } from '../hooks/useNavigate';
import { useAuth } from '../contexts/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { AppHeader } from '../components/AppHeader';
import { HeaderNav } from '../components/HeaderNav';
import { ErrorMessage } from '../components/forms';
import { apiFetch } from '../../api/client';
import type { Space } from '../../api/types';
import { formatUtcDate } from '../lib/dates';
import { Button, IconButton, TextInput } from '../ui';
import styles from './DashboardPage.module.css';

interface CreateSpaceDialogProps {
  isCreating: boolean;
  newSpaceName: string;
  onClose: () => void;
  onNameChange: (value: string) => void;
  onSubmit: () => void;
}

export function CreateSpaceDialog({
  isCreating,
  newSpaceName,
  onClose,
  onNameChange,
  onSubmit,
}: CreateSpaceDialogProps) {
  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={(event) => event.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>Create New Space</h2>
          <IconButton
            className={styles.modalClose}
            onClick={onClose}
            aria-label="Close"
            variant="ghost"
          >
            ×
          </IconButton>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <div className={styles.formGroup}>
            <label htmlFor="spaceName" className={styles.label}>
              Space Name *
            </label>
            <TextInput
              id="spaceName"
              value={newSpaceName}
              onChange={(event) => onNameChange(event.target.value)}
              className={styles.input}
              placeholder="Enter space name"
              disabled={isCreating}
              autoFocus
              fullWidth
            />
          </div>

          <div className={styles.modalActions}>
            <Button
              type="button"
              className={styles.modalActionButton}
              onClick={onClose}
              disabled={isCreating}
              variant="secondary"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className={styles.modalActionButton}
              disabled={isCreating}
              variant="primary"
            >
              {isCreating ? 'Creating...' : 'Create Space'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  useDocumentTitle('Dashboard');

  const [spaces, setSpaces] = useState<Space[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newSpaceName, setNewSpaceName] = useState('');

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }

    fetchSpaces();
  }, [user, navigate]);

  const fetchSpaces = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await apiFetch('GET /api/spaces');
      setSpaces(data.spaces || []);
    } catch (err) {
      console.error('Spaces fetch error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load spaces');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateSpace = async () => {
    if (!newSpaceName.trim()) {
      setError('Space name is required');
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      const data = await apiFetch('POST /api/spaces', {
        json: {
          name: newSpaceName.trim(),
        },
      });
      setSpaces([data.space, ...spaces]);
      setNewSpaceName('');
      setShowCreateModal(false);
    } catch (err) {
      console.error('Space creation error:', err);
      setError(err instanceof Error ? err.message : 'Failed to create space');
    } finally {
      setIsCreating(false);
    }
  };

  const getRoleBadgeClass = (role: string | undefined) => {
    switch (role?.toLowerCase()) {
      case 'owner':
        return styles.roleBadgeOwner;
      case 'admin':
        return styles.roleBadgeAdmin;
      case 'member':
        return styles.roleBadgeMember;
      default:
        return styles.roleBadgeDefault;
    }
  };

  const headerRightSlot = user ? (
    <HeaderNav userName={user.name} userEmail={user.email} />
  ) : (
    <Link to="/login" className={styles.authButton}>Sign In</Link>
  );

  return (
    <div className={styles.page}>
      <AppHeader
        leftSlot={(
          <Link to="/" className={styles.brand}>
            Make Effects
          </Link>
        )}
        rightSlot={headerRightSlot}
      />

      <main className={styles.main}>
        <div className={styles.container}>
          <div className={styles.header}>
            <h1 className={styles.title}>Your Spaces</h1>
            <Button
              className={styles.createButton}
              onClick={() => setShowCreateModal(true)}
              variant="primary"
            >
              + Create Space
            </Button>
          </div>

          <ErrorMessage message={error} />

          {isLoading ? (
            <div className={styles.loading}>Loading your spaces...</div>
          ) : spaces.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>📦</div>
              <h2 className={styles.emptyTitle}>No spaces yet</h2>
              <p className={styles.emptyDescription}>
                Create your first space to start organizing your inventory.
              </p>
              <Button
                className={styles.emptyCreateButton}
                onClick={() => setShowCreateModal(true)}
                variant="primary"
              >
                Create Your First Space
              </Button>
            </div>
          ) : (
            <div className={styles.spacesList}>
              {spaces.map((space) => (
                <Link
                  key={space.id}
                  to={`/spaces/${space.id}`}
                  className={styles.spaceCard}
                >
                  <div className={styles.spaceCardHeader}>
                    <h3 className={styles.spaceName}>{space.name}</h3>
                    <span className={`${styles.roleBadge} ${getRoleBadgeClass(space.role)}`}>
                      {space.role}
                    </span>
                  </div>
                  <div className={styles.spaceCardFooter}>
                    <span className={styles.spaceDate}>
                      Created {formatUtcDate(space.created_at)}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Create Space Modal */}
      {showCreateModal && (
        <CreateSpaceDialog
          isCreating={isCreating}
          newSpaceName={newSpaceName}
          onClose={() => setShowCreateModal(false)}
          onNameChange={setNewSpaceName}
          onSubmit={handleCreateSpace}
        />
      )}
    </div>
  );
}
