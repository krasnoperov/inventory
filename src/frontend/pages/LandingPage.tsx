import { useState } from 'react';
import { useLocation } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '../components/Link';
import { useAuth } from '../contexts/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { AppHeader } from '../components/AppHeader';
import { HeaderNav } from '../components/HeaderNav';
import { PublicNav } from '../components/PublicNav';
import { CreateSpaceDialog } from '../components/CreateSpaceDialog';
import { SpacesOverview } from '../components/SpacesOverview';
import { ErrorMessage } from '../components/forms';
import { apiFetch } from '../../api/client';
import type { Space } from '../../api/types';
import { spacesQueryOptions } from '../queries';
import { Button } from '../ui';
import styles from './LandingPage.module.css';

type ColorScheme = 'dark' | 'light';

type FeatureCard = {
  title: string;
  description: string;
  icon: React.ReactNode;
};

const FEATURES: FeatureCard[] = [
  {
    title: 'Start from the CLI',
    description:
      'Keep the fast loop. Ask your agent or shell to generate images, video, speech, music, and sound effects.',
    icon: (
      <>
        <path d="m7 8-4 4 4 4" />
        <path d="m13 16 4-4-4-4" />
      </>
    ),
  },
  {
    title: 'Remember the exploration',
    description:
      'Prompts, references, variants, lineage, and provider metadata stay attached — not lost in folders.',
    icon: (
      <>
        <path d="M4 6h16M4 12h16M4 18h10" />
        <circle cx="8" cy="6" r="1.4" />
        <circle cx="15" cy="12" r="1.4" />
      </>
    ),
  },
  {
    title: 'Choose and refine',
    description:
      'Compare directions, keep the best variants, retry failures, refine prompts, and branch when ideas grow.',
    icon: (
      <>
        <path d="M12 3v6" />
        <path d="M6 21a6 6 0 0 1 12 0" />
        <circle cx="12" cy="11" r="2.5" />
      </>
    ),
  },
  {
    title: 'Work with someone',
    description:
      'Collaborate with your agent or a colleague, then place chosen media into production records and export.',
    icon: (
      <>
        <circle cx="8" cy="9" r="2.5" />
        <circle cx="16" cy="9" r="2.5" />
        <path d="M3 19a5 5 0 0 1 10 0" />
        <path d="M13 19a5 5 0 0 1 8-4" />
      </>
    ),
  },
];

type BoardTile = {
  variant: 'character' | 'scene' | 'item' | 'composite' | 'generating';
  name: string;
  label: string;
  star?: boolean;
  spinner?: boolean;
};

const VARIANT_CLASS: Record<BoardTile['variant'], string> = {
  character: styles.tileCharacter,
  scene: styles.tileScene,
  item: styles.tileItem,
  composite: styles.tileComposite,
  generating: styles.tileGenerating,
};

const BOARD_TILES: BoardTile[] = [
  { variant: 'character', name: 'Scout', label: 'character · v3', star: true },
  { variant: 'scene', name: 'Market alley', label: 'scene · v1' },
  { variant: 'generating', name: 'Idle loop', label: 'generating…', spinner: true },
  { variant: 'item', name: 'Lantern', label: 'item · v2' },
  { variant: 'scene', name: 'Alley · night', label: 'scene · v4 ↳', star: true },
  { variant: 'composite', name: 'Hero shot', label: 'composite · v1' },
  { variant: 'character', name: 'Quartermaster', label: 'character · v2' },
  { variant: 'generating', name: 'SFX · pickup', label: '3 variants…', spinner: true },
];

function GoogleCta({ className }: { className: string }) {
  return (
    <Link to="/login" className={className}>
      <span className={styles.googleMark} aria-hidden="true" />
      Sign in with Google
    </Link>
  );
}

function LoggedOutLanding() {
  return (
    <>
      {/* ============ HERO ============ */}
      <section className={styles.container}>
        <div className={styles.hero}>
          <div className={styles.heroGrid}>
            <div className={styles.heroCopy}>
              <p className={styles.eyebrow}>makefx.app&nbsp;&nbsp;·&nbsp;&nbsp;makefx CLI</p>
              <h1 className={styles.headline}>A workspace for ideas that outgrow one prompt.</h1>
              <p className={styles.subtitle}>
                A Gemini key gets you fast, one-off media. A <strong>Space</strong> gives that speed
                a memory — variants, lineage, collaborators, and a path from exploration to finished
                files.
              </p>
              <div className={styles.ctaButtons}>
                <GoogleCta className={styles.ctaButton} />
                <a href="#cli" className={styles.ctaButtonSecondary}>
                  $ npm i -g makefx
                </a>
              </div>
            </div>

            {/* Live terminal — the signature object */}
            <div id="cli" className={styles.terminal} aria-label="makefx terminal session">
              <div className={styles.terminalBar}>
                <span className={styles.cliDot} />
                <span className={styles.cliDot} />
                <span className={styles.cliDot} />
                <span className={styles.terminalTitle}>makefx — forest-tactics</span>
              </div>
              <pre className={styles.terminalBody}>
                <span className={styles.tPrompt}>$</span> makefx login
                {'\n  '}
                <span className={styles.tOk}>✓</span> authed as{' '}
                <span className={styles.tBright}>you@studio</span>
                {'\n'}
                <span className={styles.tPrompt}>$</span> makefx generate{' '}
                <span className={styles.tStr}>&quot;rain-soaked market alley, dusk&quot;</span> \
                {'\n    --space forest-tactics -o scenes/market.png\n  '}
                <span className={styles.tOk}>✓</span> scenes/market.png{'   '}
                <span className={styles.tDim}>2.1s · nano-banana</span>
                {'\n'}
                <span className={styles.tPrompt}>$</span> makefx video{' '}
                <span className={styles.tStr}>&quot;looping idle, torchlight&quot;</span> --ref
                market.png
                {'\n  '}
                <span className={styles.tRun}>◐</span> rendering variant 03{' '}
                <span className={styles.tDim}>…</span> <span className={styles.tRun}>[running]</span>
                <span className={styles.cursor} />
              </pre>
            </div>
          </div>

          {/* Proof ticker */}
          <div className={styles.ticker} aria-label="Supported media">
            <span className={styles.tickerLead}>CLI-first</span>
            <span className={styles.tickerSep}>/</span>
            <span>Images</span>
            <span className={styles.tickerSep}>/</span>
            <span>Video</span>
            <span className={styles.tickerSep}>/</span>
            <span>Audio</span>
            <span className={styles.tickerSep}>/</span>
            <span>Variants</span>
            <span className={styles.tickerSep}>/</span>
            <span>Lineage</span>
            <span className={styles.tickerSep}>/</span>
            <span>Handoff</span>
          </div>
        </div>
      </section>

      {/* ============ THE SPACE BOARD ============ */}
      <section className={styles.container}>
        <div className={styles.section}>
          <div className={styles.sectionIntro}>
            <p className={styles.kicker}>The work is the hero</p>
            <h2 className={styles.sectionTitle}>Everything you make, in one Space.</h2>
            <p className={styles.sectionLede}>
              Assets, variants, prompts, recipes, and lineage — kept together for the people and
              agents working side by side, in real time.
            </p>
          </div>

          <div className={styles.window}>
            <div className={styles.windowToolbar}>
              <span className={styles.windowName}>forest-tactics</span>
              <span className={styles.windowTag}>Space</span>
              <span className={styles.livePill}>
                <span className={styles.liveDot} />2 generating
              </span>
              <div className={styles.avatars}>
                <span className={`${styles.avatar} ${styles.avatarA}`}>A</span>
                <span className={`${styles.avatar} ${styles.avatarM}`}>M</span>
                <span className={`${styles.avatar} ${styles.avatarC}`}>⌘</span>
              </div>
            </div>

            <div className={styles.chips}>
              <span className={styles.chipActive}>all · 8</span>
              <span className={styles.chip}>characters</span>
              <span className={styles.chip}>scenes</span>
              <span className={styles.chip}>items</span>
            </div>

            <div className={styles.boardWrap}>
              <svg
                className={styles.lineage}
                viewBox="0 0 1000 460"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <path className={styles.lineagePath} d="M 125 110 C 250 150, 280 300, 375 340" />
                <circle className={styles.lineageNode} cx="125" cy="110" r="4" />
                <circle className={styles.lineageNode} cx="375" cy="340" r="4" />
              </svg>

              <div className={styles.board}>
                {BOARD_TILES.map((tile, index) => (
                  <div
                    key={tile.name}
                    className={`${styles.tile} ${VARIANT_CLASS[tile.variant]}`}
                    style={{ animationDelay: `${index * 0.04}s` }}
                  >
                    <div className={styles.tileArt}>
                      <div className={styles.tileHatch} />
                      {tile.spinner && (
                        <div className={styles.tileSpinnerWrap}>
                          <span className={styles.spinner} />
                        </div>
                      )}
                      {tile.star && (
                        <span className={styles.tileStar} aria-hidden="true">
                          ★
                        </span>
                      )}
                      <span className={styles.tileLabel}>{tile.label}</span>
                    </div>
                    <div className={styles.tileMeta}>
                      <span className={styles.tileDot} />
                      <span className={styles.tileName}>{tile.name}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ FEATURE BLOCKS ============ */}
      <section id="features" className={styles.container}>
        <div className={styles.section}>
          <div className={styles.features}>
            {FEATURES.map((feature) => (
              <div key={feature.title} className={styles.featureItem}>
                <span className={styles.featureIcon} aria-hidden="true">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    {feature.icon}
                  </svg>
                </span>
                <h3 className={styles.featureText}>{feature.title}</h3>
                <p className={styles.featureDescription}>{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ ONE SPACE, TWO WAYS IN ============ */}
      <section className={styles.container}>
        <div className={styles.section}>
          <div className={styles.sectionIntro}>
            <p className={styles.kicker}>One Space, two ways in</p>
            <h2 className={styles.sectionTitle}>A person and an agent, on the same assets.</h2>
            <p className={styles.sectionLede}>
              The web app and the shell are two views of one Durable Object. Generate from the
              terminal; review, star, and hand off in the browser — live.
            </p>
          </div>

          <div className={styles.dual}>
            {/* LEFT: web app */}
            <div className={styles.dualWeb}>
              <div className={styles.dualBar}>
                <span className={styles.dualBarDot} />
                <span className={styles.dualBarDot} />
                <span className={styles.dualBarLabel}>A person · the web app</span>
              </div>
              <div className={styles.dualWebBody}>
                <div className={styles.dualPath}>forest-tactics / Scout</div>
                <div className={styles.variantRow}>
                  <div className={`${styles.variantCell} ${styles.variantCellActive}`}>
                    <span className={styles.variantStar} aria-hidden="true">
                      ★
                    </span>
                  </div>
                  <div className={styles.variantCell} />
                  <div className={styles.variantCell} />
                </div>
                <div className={styles.dualActions}>
                  <span className={styles.dualBtnPrimary}>Keep v3</span>
                  <span className={styles.dualBtnGhost}>Hand off →</span>
                </div>
                <div className={styles.dualReviewer}>
                  <span className={styles.dualReviewerAvatar}>A</span>Aria is reviewing now
                </div>
              </div>
            </div>

            {/* center seam */}
            <div className={styles.dualSeam} aria-hidden="true">
              <span className={styles.dualSeamPill}>space://forest-tactics</span>
            </div>

            {/* RIGHT: agent shell */}
            <div className={styles.dualShell}>
              <div className={styles.dualShellBar}>
                <span className={styles.dualShellDot} />
                <span className={styles.dualShellLabel}>An agent · the shell</span>
              </div>
              <pre className={styles.dualShellBody}>
                <span className={styles.tPrompt}>agent$</span> makefx assets --space forest-tactics
                --json
                {'\n[\n  { '}
                <span className={styles.tStr}>&quot;name&quot;</span>:{' '}
                <span className={styles.tOk}>&quot;Scout&quot;</span>,{' '}
                <span className={styles.tStr}>&quot;active&quot;</span>:{' '}
                <span className={styles.tOk}>&quot;v3&quot;</span> {'},\n  { '}
                <span className={styles.tStr}>&quot;name&quot;</span>:{' '}
                <span className={styles.tOk}>&quot;Market alley&quot;</span>,{' '}
                <span className={styles.tStr}>&quot;active&quot;</span>:{' '}
                <span className={styles.tOk}>&quot;v4&quot;</span> {'}\n]\n'}
                <span className={styles.tPrompt}>agent$</span> makefx generate{' '}
                <span className={styles.tStr}>&quot;Scout, low angle&quot;</span> \
                {'\n    --ref Scout --space forest-tactics\n  '}
                <span className={styles.tRun}>◐</span> queued variant 04{' '}
                <span className={styles.tDim}>· syncing to web</span>
                <span className={styles.cursor} />
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* ============ FOOTER CTA ============ */}
      <section className={styles.footer}>
        <div className={styles.footerCta}>
          <p className={styles.footerKicker}>makefx.app</p>
          <h2 className={styles.footerTitle}>Give your fast loop a memory.</h2>
          <p className={styles.footerLede}>
            Open a Space and bring your teammates — and your agents — into the same body of work.
          </p>
          <div className={styles.footerCtaButtons}>
            <GoogleCta className={styles.ctaButton} />
            <a href="#cli" className={styles.ctaButtonSecondary}>
              $ npm i -g makefx
            </a>
          </div>
        </div>
        <div className={styles.footerBar}>
          <div className={styles.footerBarInner}>
            <div className={styles.footerBrand}>
              <span className={styles.footerMark} aria-hidden="true">
                <span className={styles.footerMarkInner} />
              </span>
              Make Effects
            </div>
            <div className={styles.footerLinks}>
              <Link to="/pricing" className={styles.footerLink}>
                pricing
              </Link>
              <Link to="/docs/quickstart" className={styles.footerLink}>
                docs
              </Link>
              <a href="#cli" className={styles.footerLink}>
                cli
              </a>
              <a
                href="https://github.com/makefx"
                className={styles.footerLink}
                target="_blank"
                rel="noreferrer"
              >
                github
              </a>
              <a href="#" className={styles.footerLink}>
                status
              </a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

export default function LandingPage() {
  const { user } = useAuth();
  const location = useLocation();
  const queryClient = useQueryClient();
  // `/dashboard` is aliased to LandingPage (logged-in variant). Use the
  // route-specific title after hydration.
  useDocumentTitle(location.pathname === '/dashboard' ? 'Dashboard' : undefined);

  // Marketing page is dark-first (matches the design); logged-out visitors can
  // flip it locally without affecting the rest of the app, which follows the
  // system preference.
  const [scheme, setScheme] = useState<ColorScheme>('dark');

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

  return (
    <div className={styles.page} style={user ? undefined : { colorScheme: scheme }}>
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
            <PublicNav
              links={[
                { to: '/pricing', label: 'Pricing' },
                { to: '/docs/quickstart', label: 'Docs' },
              ]}
              scheme={scheme}
              onToggleScheme={() => setScheme((s) => (s === 'dark' ? 'light' : 'dark'))}
            />
          )
        }
      />

      <main className={styles.main}>
        {!user ? (
          <LoggedOutLanding />
        ) : (
          // Logged in: Show spaces list
          <div className={styles.container}>
            <div className={styles.spacesSection}>
              <div className={styles.spacesHeader}>
                <div className={styles.spacesHeading}>
                  <p className={styles.kicker}>Your workspace</p>
                  <h1 className={styles.spacesTitle}>Your Spaces</h1>
                </div>
                <Button
                  className={styles.createButton}
                  onClick={() => setShowCreateModal(true)}
                  variant="primary"
                >
                  + Create Space
                </Button>
              </div>

              <ErrorMessage
                message={error || (spacesQuery.error instanceof Error ? spacesQuery.error.message : null)}
              />

              <SpacesOverview
                spaces={spaces}
                isLoading={isLoading}
                emptyDescription="Create your first space to start organizing your production assets."
                onCreateSpace={() => setShowCreateModal(true)}
              />
            </div>
          </div>
        )}
      </main>

      {/* Create Space Modal */}
      {showCreateModal && (
        <CreateSpaceDialog
          isCreating={isCreating}
          newSpaceName={newSpaceName}
          onClose={() => setShowCreateModal(false)}
          onNameChange={setNewSpaceName}
          onSubmit={handleCreateSpace}
          surface="public"
        />
      )}
    </div>
  );
}
