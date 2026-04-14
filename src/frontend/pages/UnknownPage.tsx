import { Link } from '../components/Link';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { AppHeader } from '../components/AppHeader';
import styles from './UnknownPage.module.css';

export default function UnknownPage() {
  useDocumentTitle('Not found');

  return (
    <div className={styles.page}>
      <AppHeader
        leftSlot={(
          <Link to="/" className={styles.brand}>
            Inventory
          </Link>
        )}
      />
      <main className={styles.main}>
        <div className={styles.card}>
          <h1 className={styles.code}>404</h1>
          <p className={styles.message}>We couldn't find that page.</p>
          <Link to="/" className={styles.homeLink}>Back to home</Link>
        </div>
      </main>
    </div>
  );
}
