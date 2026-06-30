import { useState } from 'react';
import { AppHeader } from '../components/AppHeader';
import { HeaderNav } from '../components/HeaderNav';
import { Link } from '../components/Link';
import { PublicThemeToggle, type PublicThemeScheme } from '../components/PublicThemeToggle';
import { useAuth } from '../contexts/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import styles from './PricingPage.module.css';

type ColorScheme = PublicThemeScheme;

type PricingPlan = {
  name: string;
  eyebrow: string;
  price: string;
  cadence: string;
  description: string;
  cta: string;
  ctaTo: string;
  highlighted?: boolean;
  features: string[];
  meters: string[];
};

const PLANS: PricingPlan[] = [
  {
    name: 'Managed AI',
    eyebrow: 'Hosted provider keys',
    price: 'Paid Generation',
    cadence: 'Metered in Polar by media and token usage',
    description:
      'Use Make Effects managed generation when you want provider access handled by the hosted app instead of separate provider setup.',
    cta: 'Start managed AI',
    ctaTo: '/login',
    highlighted: true,
    features: [
      'Gemini image, video, and music generation through the hosted workflow',
      'ElevenLabs speech, dialogue, music, and sound effect workflows when enabled',
      'Claude-assisted planning, prompt refinement, and asset review',
      'Polar-hosted checkout, invoices, taxes, and customer billing portal',
    ],
    meters: [
      'Gemini images, videos, audio, input tokens, and output tokens',
      'Claude input and output tokens',
      'ElevenLabs audio usage',
    ],
  },
  {
    name: 'BYOK Platform',
    eyebrow: 'Bring your own keys',
    price: 'Your provider bill',
    cadence: 'Make Effects tracks platform guardrails separately',
    description:
      'Connect supported provider keys and use Make Effects for storage, workflow orchestration, collaboration, and production handoff. Provider charges stay with your provider account.',
    cta: 'Set up BYOK',
    ctaTo: '/login',
    features: [
      'Stored provider keys are encrypted and preferred over hosted platform keys',
      'Generation can run without managed AI entitlement when a matching key is present',
      'Platform guardrails cover workflow runs, storage, delivery, and video runs',
      'Spaces, variants, lineage, CLI access, and production records stay available',
    ],
    meters: [
      'Platform workflow runs',
      'Platform storage and authenticated media delivery',
      'Video workflow fair-use limits by account and space',
    ],
  },
];

const COMPARE_ROWS = [
  ['Provider billing', 'Through the Make Effects Paid Generation plan', 'Directly on your provider account'],
  ['Provider setup', 'No provider keys required', 'Add supported provider keys in profile'],
  ['Usage controls', 'Managed quotas, rate limits, and provider-cost guardrails', 'Platform guardrails and rate limits'],
  ['Best for', 'Teams that want hosted generation ready immediately', 'Teams with existing provider contracts or credits'],
] as const;

function PublicNav({
  scheme,
  onToggleScheme,
}: {
  scheme: ColorScheme;
  onToggleScheme: () => void;
}) {
  return (
    <nav className={styles.nav} aria-label="Public navigation">
      <Link to="/" className={styles.navLink}>Home</Link>
      <Link to="/docs/quickstart" className={styles.navLink}>Docs</Link>
      <PublicThemeToggle scheme={scheme} onToggle={onToggleScheme} />
      <Link to="/login" className={styles.authButton}>Sign in</Link>
    </nav>
  );
}

export default function PricingPage() {
  const { user } = useAuth();
  const [scheme, setScheme] = useState<ColorScheme>('dark');
  useDocumentTitle('Pricing');

  const ctaTarget = user ? '/profile' : '/login';

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
              scheme={scheme}
              onToggleScheme={() => setScheme((current) => (current === 'dark' ? 'light' : 'dark'))}
            />
          )
        }
      />

      <main className={styles.main}>
        <section className={styles.hero}>
          <div className={styles.container}>
            <p className={styles.eyebrow}>Pricing</p>
            <h1 className={styles.headline}>Managed AI for hosted generation. BYOK when you bring the provider account.</h1>
            <p className={styles.subtitle}>
              Make Effects separates customer metering, provider-cost attribution, and platform guardrails, so a studio can choose hosted generation or route jobs through its own keys without changing the asset workspace.
            </p>
            <div className={styles.heroActions}>
              <Link to={ctaTarget} className={styles.ctaButton}>
                {user ? 'Manage billing' : 'Start with Google'}
              </Link>
              <Link to="/docs/quickstart" className={styles.ctaButtonSecondary}>
                Read the quickstart
              </Link>
            </div>
          </div>
        </section>

        <section className={styles.container} aria-label="Plans">
          <div className={styles.planGrid}>
            {PLANS.map((plan) => (
              <article
                key={plan.name}
                className={`${styles.planCard} ${plan.highlighted ? styles.planCardHighlighted : ''}`}
              >
                <div className={styles.planHeader}>
                  <p className={styles.planEyebrow}>{plan.eyebrow}</p>
                  <h2 className={styles.planName}>{plan.name}</h2>
                  <div className={styles.priceRow}>
                    <span className={styles.price}>{plan.price}</span>
                    <span className={styles.cadence}>{plan.cadence}</span>
                  </div>
                  <p className={styles.planDescription}>{plan.description}</p>
                </div>

                <Link to={user ? '/profile' : plan.ctaTo} className={plan.highlighted ? styles.planCtaPrimary : styles.planCta}>
                  {user ? 'Open billing settings' : plan.cta}
                </Link>

                <div className={styles.planDetails}>
                  <h3 className={styles.detailTitle}>Included workflow</h3>
                  <ul className={styles.featureList}>
                    {plan.features.map((feature) => (
                      <li key={feature}>{feature}</li>
                    ))}
                  </ul>
                </div>

                <div className={styles.meterBox}>
                  <h3 className={styles.detailTitle}>Usage tracked</h3>
                  <ul className={styles.meterList}>
                    {plan.meters.map((meter) => (
                      <li key={meter}>{meter}</li>
                    ))}
                  </ul>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.container}>
          <div className={styles.compareSection}>
            <div className={styles.sectionIntro}>
              <p className={styles.kicker}>Plan fit</p>
              <h2 className={styles.sectionTitle}>Same workspace, different billing path.</h2>
            </div>
            <div className={styles.compareTable} role="table" aria-label="Managed AI and BYOK comparison">
              <div className={styles.compareHeader} role="row">
                <span role="columnheader">Decision</span>
                <span role="columnheader">Managed AI</span>
                <span role="columnheader">BYOK Platform</span>
              </div>
              {COMPARE_ROWS.map(([label, managed, byok]) => (
                <div key={label} className={styles.compareRow} role="row">
                  <span className={styles.compareLabel} role="cell">{label}</span>
                  <span role="cell">{managed}</span>
                  <span role="cell">{byok}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.footer}>
          <div className={styles.footerInner}>
            <div>
              <p className={styles.footerKicker}>makefx.app</p>
              <h2 className={styles.footerTitle}>Choose the billing mode that matches the way your studio buys AI.</h2>
            </div>
            <Link to={ctaTarget} className={styles.ctaButton}>
              {user ? 'Open profile' : 'Create a Space'}
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
