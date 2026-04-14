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
              <h2 className={styles.headline}>Build Your Next Project</h2>
              <p className={styles.subtitle}>
                A modern, authenticated web application framework on Cloudflare Workers.
                Multi-user support, dual-worker architecture, real-time chat, and ready for your domain logic.
              </p>

              <div className={styles.features}>
                <div className={styles.featureItem}>
                  <span className={styles.featureIcon} aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="4" y="11" width="16" height="9" rx="2" />
                      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                    </svg>
                  </span>
                  <span className={styles.featureText}>Authentication</span>
                  <span className={styles.featureDescription}>Google OAuth with JWT tokens, secure user sessions</span>
                </div>
                <div className={styles.featureItem}>
                  <span className={styles.featureIcon} aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="9" cy="8" r="3.25" />
                      <circle cx="17" cy="9" r="2.5" />
                      <path d="M2.75 19c.5-3 3-5 6.25-5s5.75 2 6.25 5" />
                      <path d="M15 19c.5-2.5 2.5-4 5-4" />
                    </svg>
                  </span>
                  <span className={styles.featureText}>Multi-User</span>
                  <span className={styles.featureDescription}>User profiles, role-based access, complete user management</span>
                </div>
                <div className={styles.featureItem}>
                  <span className={styles.featureIcon} aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />
                    </svg>
                  </span>
                  <span className={styles.featureText}>Dual Workers</span>
                  <span className={styles.featureDescription}>HTTP worker for API + frontend, processing worker for async jobs</span>
                </div>
                <div className={styles.featureItem}>
                  <span className={styles.featureIcon} aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-8l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
                    </svg>
                  </span>
                  <span className={styles.featureText}>Real-Time Chat</span>
                  <span className={styles.featureDescription}>Chat components ready for AI integration or messaging</span>
                </div>
              </div>

              <div className={styles.ctaButtons}>
                <Link to="/login" className={styles.ctaButton}>Get Started</Link>
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
