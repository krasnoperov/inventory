import type { HTMLAttributes, ReactNode } from 'react';
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

interface WorkspaceLayoutProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

interface WorkspaceSlotProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

interface WorkspaceBottomStackProps extends WorkspaceSlotProps {
  ariaLabel?: string;
}

interface WorkspacePanelProps extends WorkspaceSlotProps {
  ariaLabel: string;
  role?: 'region' | 'complementary';
}

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

export function WorkspaceLayout({ children, className, ...props }: WorkspaceLayoutProps) {
  return (
    <div className={mergeClasses(styles.layout, className)} {...props}>
      {children}
    </div>
  );
}

export function WorkspaceCanvas({ children, className, ...props }: WorkspaceSlotProps) {
  return (
    <div className={mergeClasses(styles.canvas, className)} {...props}>
      {children}
    </div>
  );
}

export function WorkspaceBottomStack({
  children,
  className,
  ariaLabel = 'Workspace controls',
}: WorkspaceBottomStackProps) {
  return (
    <section className={mergeClasses(styles.bottomStack, className)} aria-label={ariaLabel}>
      {children}
    </section>
  );
}

export function WorkspacePanel({
  children,
  className,
  ariaLabel,
  role = 'region',
}: WorkspacePanelProps) {
  return (
    <section className={mergeClasses(styles.panel, className)} role={role} aria-label={ariaLabel}>
      {children}
    </section>
  );
}
