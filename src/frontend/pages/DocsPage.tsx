import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link } from '../components/Link';
import { AppHeader } from '../components/AppHeader';
import { HeaderNav } from '../components/HeaderNav';
import { useAuth } from '../contexts/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { DOCS, getDocBySlug } from '../content/docs-manifest';
import styles from './DocsPage.module.css';

type DocsPageProps = {
  slug?: string;
};

export default function DocsPage({ slug }: DocsPageProps) {
  const { user } = useAuth();
  const doc = getDocBySlug(slug);
  useDocumentTitle(doc.slug === 'quickstart' ? 'Docs' : doc.title);

  return (
    <div className={styles.page}>
      <AppHeader
        leftSlot={<Link to="/" className={styles.brand}>Make Effects</Link>}
        rightSlot={
          user ? (
            <HeaderNav userName={user.name} userEmail={user.email} />
          ) : (
            <Link to="/login" className={styles.authButton}>Sign In</Link>
          )
        }
      />

      <main className={styles.main}>
        <header className={styles.hero}>
          <p className={styles.eyebrow}>Public docs</p>
          <h1 className={styles.title}>Build media workflows with makefx.</h1>
          <p className={styles.subtitle}>
            Learn how Make Effects tracks generated images, audio, and video for
            humans, scripts, and AI agents.
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
