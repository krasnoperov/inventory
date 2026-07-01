import { Link } from './Link';
import { PublicThemeToggle, type PublicThemeScheme } from './PublicThemeToggle';
import { ButtonLink } from '../ui';
import styles from './PublicNav.module.css';

export interface PublicNavLink {
  to: string;
  label: string;
}

interface PublicNavProps {
  links: PublicNavLink[];
  scheme: PublicThemeScheme;
  onToggleScheme: () => void;
}

export function PublicNav({ links, scheme, onToggleScheme }: PublicNavProps) {
  return (
    <nav className={styles.nav} aria-label="Public navigation">
      {links.map((link) => (
        <Link key={link.to} to={link.to} className={styles.navLink}>
          {link.label}
        </Link>
      ))}
      <PublicThemeToggle scheme={scheme} onToggle={onToggleScheme} />
      <ButtonLink to="/login" className={styles.authAction} variant="primary" size="sm">
        Sign in
      </ButtonLink>
    </nav>
  );
}
