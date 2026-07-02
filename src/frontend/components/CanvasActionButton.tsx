import type { ReactNode } from 'react';
import { IconButton } from '../ui';
import styles from './CanvasActionButton.module.css';

type CanvasActionButtonSize = 'compact' | 'mediaOverlay' | 'panel';

interface CanvasActionButtonProps {
  active?: boolean;
  activeClassName?: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  label: string;
  onClick?: () => void;
  size?: CanvasActionButtonSize;
}

const cx = (...values: Array<string | false | undefined>) => values.filter(Boolean).join(' ');

export function CanvasActionButton({
  active = false,
  activeClassName = styles.added,
  children,
  className,
  disabled = false,
  label,
  onClick,
  size = 'compact',
}: CanvasActionButtonProps) {
  return (
    <IconButton
      className={cx(styles.button, size !== 'compact' && styles[size], active && activeClassName, className)}
      disabled={disabled}
      onClick={onClick}
      title={label}
      aria-label={label}
      variant="ghost"
      size="sm"
    >
      {children}
    </IconButton>
  );
}

export default CanvasActionButton;
