import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { ButtonLink, IconButton } from '../ui';
import styles from './CanvasToolbar.module.css';

const mergeClasses = (...values: Array<string | undefined | false>) =>
  values.filter(Boolean).join(' ');

interface CanvasToolbarProps {
  children: ReactNode;
  ariaLabel: string;
  className?: string;
}

export function CanvasToolbar({ children, ariaLabel, className }: CanvasToolbarProps) {
  return (
    <div className={mergeClasses(styles.toolbar, className)} role="toolbar" aria-label={ariaLabel}>
      {children}
    </div>
  );
}

interface CanvasToolbarTitleProps {
  children: ReactNode;
  className?: string;
}

export function CanvasToolbarTitle({ children, className }: CanvasToolbarTitleProps) {
  return <div className={mergeClasses(styles.title, className)}>{children}</div>;
}

interface CanvasToolbarBadgeProps {
  children: ReactNode;
  tone?: 'owner' | 'editor' | 'viewer' | 'neutral';
  className?: string;
}

export function CanvasToolbarBadge({ children, tone = 'neutral', className }: CanvasToolbarBadgeProps) {
  return (
    <span className={mergeClasses(styles.badge, styles[tone], className)}>
      {children}
    </span>
  );
}

interface CanvasToolbarStatProps {
  icon?: ReactNode;
  children: ReactNode;
  title?: string;
  className?: string;
}

export function CanvasToolbarStat({ icon, children, title, className }: CanvasToolbarStatProps) {
  return (
    <span className={mergeClasses(styles.stat, className)} title={title}>
      {icon}
      {children}
    </span>
  );
}

interface CanvasToolbarGroupProps {
  children: ReactNode;
  className?: string;
}

export function CanvasToolbarGroup({ children, className }: CanvasToolbarGroupProps) {
  return <div className={mergeClasses(styles.group, className)}>{children}</div>;
}

export function CanvasToolbarDivider() {
  return <div className={styles.divider} aria-hidden="true" />;
}

export function CanvasToolbarLive() {
  return <span className={styles.liveIndicator}>Live</span>;
}

interface CanvasToolbarButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  danger?: boolean;
}

export function CanvasToolbarButton({
  active = false,
  danger = false,
  className,
  type = 'button',
  title,
  ...props
}: CanvasToolbarButtonProps) {
  const ariaLabel = props['aria-label'] ?? (typeof title === 'string' ? title : 'Toolbar action');

  return (
    <IconButton
      {...props}
      aria-label={ariaLabel}
      title={title}
      type={type}
      variant={active ? 'secondary' : 'ghost'}
      className={mergeClasses(
        styles.button,
        active && styles.active,
        danger && styles.danger,
        className,
      )}
    />
  );
}

interface CanvasToolbarLinkProps {
  to: string;
  children: ReactNode;
  title: string;
  className?: string;
  ariaLabel?: string;
}

export function CanvasToolbarLink({ to, children, title, className, ariaLabel }: CanvasToolbarLinkProps) {
  return (
    <ButtonLink
      to={to}
      variant="ghost"
      className={mergeClasses(styles.button, className)}
      title={title}
      aria-label={ariaLabel || title}
    >
      {children}
    </ButtonLink>
  );
}
