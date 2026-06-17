import type { ReactNode } from 'react';
import { TopLoadingBar } from './TopLoadingBar';
import styles from './WorkspaceChrome.module.css';

interface WorkspaceChromeProps {
  leftSlot?: ReactNode;
  centerSlot?: ReactNode;
  rightSlot?: ReactNode;
  statusSlot?: ReactNode;
  className?: string;
  isLoading?: boolean;
}

const mergeClasses = (...values: Array<string | undefined | false>) =>
  values.filter(Boolean).join(' ');

export function WorkspaceChrome({
  leftSlot,
  centerSlot,
  rightSlot,
  statusSlot,
  className,
  isLoading = false,
}: WorkspaceChromeProps) {
  return (
    <>
      <TopLoadingBar isLoading={isLoading} />
      <header className={mergeClasses(styles.wrapper, className)}>
        <nav className={styles.chrome} aria-label="Workspace navigation">
          <div className={styles.left}>{leftSlot}</div>
          <div className={styles.center}>{centerSlot}</div>
          <div className={styles.right}>
            {statusSlot}
            {rightSlot}
          </div>
        </nav>
      </header>
    </>
  );
}
