import { Button } from '../ui';
import styles from './PublicThemeToggle.module.css';

export type PublicThemeScheme = 'dark' | 'light';

interface PublicThemeToggleProps {
  scheme: PublicThemeScheme;
  onToggle: () => void;
}

export function PublicThemeToggle({ scheme, onToggle }: PublicThemeToggleProps) {
  return (
    <Button
      className={styles.toggle}
      onClick={onToggle}
      aria-label="Toggle theme"
      variant="secondary"
      size="sm"
    >
      <span className={styles.dot} aria-hidden="true" />
      {scheme === 'dark' ? 'Light' : 'Dark'}
    </Button>
  );
}
