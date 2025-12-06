import { useEffect, useState } from 'react';
import { Link } from '../components/Link';
import { useNavigate } from '../hooks/useNavigate';
import { useAuth } from '../contexts/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { AppHeader } from '../components/AppHeader';
import { HeaderNav } from '../components/HeaderNav';
import { ErrorMessage } from '../components/forms';
import styles from './DashboardPage.module.css';

interface Space {
  id: number;
  name: string;
  role: string;
  created_at: string;
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
      const response = await fetch('/api/spaces', {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch spaces');
      }

      const data = await response.json() as { success: boolean; spaces: Space[] };
      setSpaces(data.spaces || []);
    } catch (err) {
      console.error('Spaces fetch error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load spaces');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateSpace = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!newSpaceName.trim()) {
      setError('Space name is required');
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      const response = await fetch('/api/spaces', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: newSpaceName.trim(),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json() as { error?: string };
        throw new Error(errorData.error || 'Failed to create space');
      }

      const data = await response.json() as { success: boolean; space: Space };
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

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
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
            Inventory
          </Link>
        )}
        rightSlot={headerRightSlot}
      />

      <main className={styles.main}>
        <div className={styles.container}>
          <div className={styles.header}>
            <h1 className={styles.title}>Your Spaces</h1>
            <button
              className={styles.createButton}
              onClick={() => setShowCreateModal(true)}
            >
              + Create Space
            </button>
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
              <button
                className={styles.emptyCreateButton}
                onClick={() => setShowCreateModal(true)}
              >
                Create Your First Space
              </button>
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
                      Created {formatDate(space.created_at)}
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
        <div className={styles.modalOverlay} onClick={() => setShowCreateModal(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Create New Space</h2>
              <button
                className={styles.modalClose}
                onClick={() => setShowCreateModal(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleCreateSpace}>
              <div className={styles.formGroup}>
                <label htmlFor="spaceName" className={styles.label}>
                  Space Name *
                </label>
                <input
                  id="spaceName"
                  type="text"
                  value={newSpaceName}
                  onChange={(e) => setNewSpaceName(e.target.value)}
                  className={styles.input}
                  placeholder="Enter space name"
                  disabled={isCreating}
                  autoFocus
                />
              </div>

              <div className={styles.modalActions}>
                <button
                  type="button"
                  className={styles.cancelButton}
                  onClick={() => setShowCreateModal(false)}
                  disabled={isCreating}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={styles.submitButton}
                  disabled={isCreating}
                >
                  {isCreating ? 'Creating...' : 'Create Space'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
