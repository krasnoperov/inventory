import { useState } from 'react';
import { useLocation } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '../components/Link';
import { useAuth } from '../contexts/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { AppHeader } from '../components/AppHeader';
import { HeaderNav } from '../components/HeaderNav';
import { ErrorMessage } from '../components/forms';
import { apiFetch } from '../../api/client';
import type { Space } from '../../api/types';
import { spacesQueryOptions } from '../queries';
import styles from './LandingPage.module.css';

export default function LandingPage() {
  const { user } = useAuth();
  const location = useLocation();
  const queryClient = useQueryClient();
  // `/dashboard` is aliased to LandingPage (logged-in variant). Use the
  // route-specific title after hydration.
  useDocumentTitle(location.pathname === '/dashboard' ? 'Dashboard' : undefined);

  // Spaces state (only used when logged in)
  const spacesQuery = useQuery({
    ...spacesQueryOptions(),
    enabled: Boolean(user),
  });
  const spaces = spacesQuery.data || [];
  const isLoading = spacesQuery.isPending && Boolean(user);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newSpaceName, setNewSpaceName] = useState('');

  const handleCreateSpace = async (event: React.FormEvent) => {
    event.preventDefault();

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
      queryClient.setQueryData<Space[]>(spacesQueryOptions().queryKey, (current) => [
        data.space,
        ...(current || []),
      ]);
      setNewSpaceName('');
      setShowCreateModal(false);
    } catch (err) {
      console.error('Space creation error:', err);
      setError(err instanceof Error ? err.message : 'Failed to create space');
    } finally {
      setIsCreating(false);
    }
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
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
            Make Effects
          </Link>
        )}
        rightSlot={
          user ? (
            <HeaderNav userName={user.name} userEmail={user.email} />
          ) : (
            <nav className={styles.nav} aria-label="Public navigation">
              <Link to="/docs/quickstart" className={styles.navLink}>Docs</Link>
              <Link to="/login" className={styles.authButton}>Sign In</Link>
            </nav>
          )
        }
      />

      <main className={styles.main}>
        <div className={styles.container}>
          {!user ? (
            // Logged out: Show hero and features
            <div className={styles.hero}>
              <div className={styles.heroGrid}>
                <section className={styles.heroCopy} aria-labelledby="landing-heading">
                  <p className={styles.eyebrow}>makefx.app + makefx CLI</p>
                  <h1 id="landing-heading" className={styles.headline}>
                    AI media production for agents and teams.
                  </h1>
                  <p className={styles.subtitle}>
                    Generate images, video, and audio from the web app or CLI.
                    Track every result with variants, prompt history, lineage,
                    and production-ready handoff.
                  </p>

                  <div className={styles.ctaButtons}>
                    <Link to="/login" className={styles.ctaButton}>Sign in with Google</Link>
                    <a className={styles.ctaButtonSecondary} href="#cli">Use the CLI</a>
                  </div>
                </section>

                <aside id="cli" className={styles.cliPanel} aria-label="Make Effects CLI examples">
                  <div className={styles.cliHeader}>
                    <span className={styles.cliDot} />
                    <span className={styles.cliDot} />
                    <span className={styles.cliDot} />
                    <span className={styles.cliTitle}>makefx</span>
                  </div>
                  <pre className={styles.cliCode}>
                    <code>{`npm install -g makefx
makefx login

makefx generate "A market background" \\
  -o art/market.png
makefx audio sfx generate "Magic pickup" \\
  -o audio/pickup.wav
makefx video generate "Looping idle animation" \\
  -o video/idle.mp4
makefx assets --json`}</code>
                  </pre>
                </aside>
              </div>

              <div className={styles.mediaStrip} aria-label="Supported media">
                <span>Images</span>
                <span>Video</span>
                <span>Audio</span>
                <span>Variants</span>
                <span>Lineage</span>
                <span>Handoff</span>
              </div>

              <div className={styles.features}>
                <div className={styles.featureItem}>
                  <span className={styles.featureIcon} aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="4" y="5" width="16" height="12" rx="2" />
                      <path d="m7 14 3-3 2 2 2-3 3 4" />
                      <circle cx="9" cy="9" r="1" />
                    </svg>
                  </span>
                  <span className={styles.featureText}>Generate media</span>
                  <span className={styles.featureDescription}>
                    Create images, video, speech, dialogue, music, and sound effects through website-backed jobs.
                  </span>
                </div>
                <div className={styles.featureItem}>
                  <span className={styles.featureIcon} aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 5h16M4 12h16M4 19h16" />
                      <path d="M8 5v14M16 5v14" />
                      <circle cx="8" cy="12" r="2" />
                      <circle cx="16" cy="19" r="2" />
                    </svg>
                  </span>
                  <span className={styles.featureText}>Track every result</span>
                  <span className={styles.featureDescription}>
                    Keep variants, prompts, provider metadata, and source references attached to every asset.
                  </span>
                </div>
                <div className={styles.featureItem}>
                  <span className={styles.featureIcon} aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 7h16" />
                      <path d="M7 12h10" />
                      <path d="M10 17h4" />
                      <path d="m5 4-2 3 2 3" />
                      <path d="m19 14 2 3-2 3" />
                    </svg>
                  </span>
                  <span className={styles.featureText}>Agent-ready CLI</span>
                  <span className={styles.featureDescription}>
                    Let automation call `makefx generate`, watch jobs, download files, and inspect assets as JSON.
                  </span>
                </div>
                <div className={styles.featureItem}>
                  <span className={styles.featureIcon} aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 4h10l4 4v12H5z" />
                      <path d="M15 4v5h5" />
                      <path d="M8 13h8M8 17h5" />
                    </svg>
                  </span>
                  <span className={styles.featureText}>Production handoff</span>
                  <span className={styles.featureDescription}>
                    Organize media in shared spaces, place production records, and export files for downstream tools.
                  </span>
                </div>
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

              <ErrorMessage
                message={error || (spacesQuery.error instanceof Error ? spacesQuery.error.message : null)}
              />

              {isLoading ? (
                <div className={styles.loading}>Loading your spaces...</div>
              ) : spaces.length === 0 ? (
                <div className={styles.emptyState}>
                  <div className={styles.emptyIcon}>📦</div>
                  <h2 className={styles.emptyTitle}>No spaces yet</h2>
                  <p className={styles.emptyDescription}>
                    Create your first space to start organizing your production assets.
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
