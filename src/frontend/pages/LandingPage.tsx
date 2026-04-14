import { useEffect, useState } from 'react';
import { Link } from '../components/Link';
import { useNavigate } from '../hooks/useNavigate';
import { useAuth } from '../contexts/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { AppHeader } from '../components/AppHeader';
import { HeaderNav } from '../components/HeaderNav';
import { ErrorMessage } from '../components/forms';
import { useRouteStore } from '../stores/routeStore';
import styles from './LandingPage.module.css';

interface Space {
  id: number;
  name: string;
  role: string;
  created_at: string;
}

export default function LandingPage() {
  const _navigate = useNavigate(); // eslint-disable-line @typescript-eslint/no-unused-vars
  const { user } = useAuth();
  // `/dashboard` is aliased to LandingPage (logged-in variant). Use the
  // route-specific title so the client matches the worker's rewritten
  // <title> after hydration instead of overwriting it.
  const routePage = useRouteStore((state) => state.page);
  useDocumentTitle(routePage === 'dashboard' ? 'Dashboard' : undefined);

  // Spaces state (only used when logged in)
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newSpaceName, setNewSpaceName] = useState('');

  useEffect(() => {
    if (user) {
      fetchSpaces();
    }
  }, [user]);

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

  return (
    <div className={styles.page}>
      <AppHeader
        leftSlot={(
          <Link to="/" className={styles.brand}>
            Inventory
          </Link>
        )}
        rightSlot={
          user ? (
            <HeaderNav userName={user.name} userEmail={user.email} />
          ) : (
            <Link to="/login" className={styles.authButton}>Sign In</Link>
          )
        }
      />

      <main className={styles.main}>
        <div className={styles.container}>
          {!user ? (
            // Logged out: Show hero and features
            <div className={styles.hero}>
              <h2 className={styles.headline}>
                An inventory for AI-generated game art.
              </h2>
              <p className={styles.subtitle}>
                Generate, refine, and forge visual assets with full lineage,
                real-time collaboration, and pipelines built for sprite sheets
                and turnarounds.
              </p>

              <div className={styles.features}>
                <div className={styles.featureItem}>
                  <span className={styles.featureIcon} aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="5" r="2.5" />
                      <circle cx="6" cy="13" r="2.5" />
                      <circle cx="18" cy="13" r="2.5" />
                      <circle cx="12" cy="20" r="2.5" />
                      <path d="M12 7.5v2M12 16.5v1M10 6.75 7.5 11.25M14 6.75 16.5 11.25M8 14.5l3 4M16 14.5l-3 4" />
                    </svg>
                  </span>
                  <span className={styles.featureText}>Lineage &amp; recipes</span>
                  <span className={styles.featureDescription}>
                    Every variant remembers the prompt and source assets that made it.
                  </span>
                </div>
                <div className={styles.featureItem}>
                  <span className={styles.featureIcon} aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M6 4h4v4H6zM14 4h4v4h-4zM6 12h4v4H6zM14 12h4v4h-4z" />
                      <path d="M9 18h6l-1 3h-4z" />
                    </svg>
                  </span>
                  <span className={styles.featureText}>Forge</span>
                  <span className={styles.featureDescription}>
                    Combine existing assets into new ones. Lineage is computed automatically.
                  </span>
                </div>
                <div className={styles.featureItem}>
                  <span className={styles.featureIcon} aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="6" height="6" rx="1" />
                      <rect x="11" y="3" width="6" height="6" rx="1" />
                      <rect x="3" y="11" width="6" height="6" rx="1" />
                      <path d="M14 11.5a4.5 4.5 0 1 1 0 7" />
                      <path d="M13 15.5 14 18l2.5-.5" />
                    </svg>
                  </span>
                  <span className={styles.featureText}>Tile &amp; rotation pipelines</span>
                  <span className={styles.featureDescription}>
                    Spritesheets, directional turnarounds, and seamless tiles in one flow.
                  </span>
                </div>
                <div className={styles.featureItem}>
                  <span className={styles.featureIcon} aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="8" cy="9" r="3" />
                      <circle cx="16" cy="9" r="3" />
                      <path d="M2.5 20c.5-3 2.75-5 5.5-5s5 2 5.5 5" />
                      <path d="M10.5 20c.5-3 2.75-5 5.5-5s5 2 5.5 5" />
                    </svg>
                  </span>
                  <span className={styles.featureText}>Real-time spaces</span>
                  <span className={styles.featureDescription}>
                    Bring your art director into the same session. Full-state sync over WebSockets.
                  </span>
                </div>
              </div>

              <div className={styles.ctaButtons}>
                <Link to="/login" className={styles.ctaButton}>Sign in with Google</Link>
              </div>
            </div>
          ) : (
            // Logged in: Show spaces list
            <div className={styles.spacesSection}>
              <div className={styles.spacesHeader}>
                <h1 className={styles.spacesTitle}>Your Spaces</h1>
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
