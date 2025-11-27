import { Link } from './Link';
import styles from './HeaderNav.module.css';

interface HeaderNavProps {
  userName?: string | null;
  userEmail?: string | null;
  className?: string;
  showDashboard?: boolean;
}

export const HeaderNav: React.FC<HeaderNavProps> = ({ userName, userEmail, className, showDashboard = true }) => {
  const displayName = userName || userEmail || '';

  return (
    <nav className={`${styles.nav} ${className || ''}`}>
      {showDashboard && (
        <Link to="/dashboard" className={styles.navLink}>Dashboard</Link>
      )}
      <Link to="/profile" className={styles.navLink}>{displayName}</Link>
    </nav>
  );
};
