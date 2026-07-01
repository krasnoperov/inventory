import { useEffect, useState } from 'react';
import { Link } from '../components/Link';
import { useNavigate } from '../hooks/useNavigate';
import { useAuth } from '../contexts/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { AppHeader } from '../components/AppHeader';
import { HeaderNav } from '../components/HeaderNav';
import { CreateSpaceDialog } from '../components/CreateSpaceDialog';
import { ErrorMessage } from '../components/forms';
import { apiFetch } from '../../api/client';
import type { Space } from '../../api/types';
import { formatUtcDate } from '../lib/dates';
import { Button, ButtonLink } from '../ui';
import styles from './DashboardPage.module.css';

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
    <ButtonLink to="/login" variant="primary">Sign In</ButtonLink>
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
