import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link } from '../components/Link';
import { AppHeader } from '../components/AppHeader';
import { HeaderNav } from '../components/HeaderNav';
import { useAuth } from '../contexts/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { DOCS, getDefaultDoc, getDocBySlug } from '../content/docs-manifest';
import { ButtonLink } from '../ui';
import styles from './DocsPage.module.css';

type DocsPageProps = {
  slug?: string;
};

export default function DocsPage({ slug }: DocsPageProps) {
  const { user } = useAuth();
  const doc = (slug ? getDocBySlug(slug) : undefined) ?? getDefaultDoc();
  useDocumentTitle(doc.slug === 'quickstart' ? 'Docs' : doc.title);

  return (
    <div className={styles.page}>
      <AppHeader
        leftSlot={<Link to="/" className={styles.brand}>Make Effects</Link>}
        rightSlot={
          user ? (
            <HeaderNav userName={user.name} userEmail={user.email} />
          ) : (
            <ButtonLink to="/login" variant="primary">Sign In</ButtonLink>
          )
        }
      />

      <main className={styles.main}>
        <header className={styles.hero}>
          <p className={styles.eyebrow}>Public docs</p>
          <h1 className={styles.title}>Keep the thread of your media project.</h1>
          <p className={styles.subtitle}>
            Start with the CLI, explore with an agent or colleague, and keep the
            variants, prompts, relationships, and chosen files together.
          </p>
        </header>

        <div className={styles.layout}>
          <aside className={styles.sidebar} aria-label="Docs navigation">
            <p className={styles.sidebarTitle}>Docs</p>
            <nav className={styles.navList}>
              {DOCS.map((entry) => (
                <Link
                  key={entry.slug}
                  to={entry.path}
                  className={`${styles.navLink} ${entry.slug === doc.slug ? styles.navLinkActive : ''}`}
                >
                  {entry.title}
                </Link>
              ))}
            </nav>
          </aside>

          <article className={styles.article}>
            <p className={styles.docDescription}>{doc.description}</p>
            <div className={styles.markdown}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {doc.content}
              </ReactMarkdown>
            </div>
          </article>
        </div>
      </main>
    </div>
  );
}
