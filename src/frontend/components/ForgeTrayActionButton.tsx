import { IconButton } from '../ui';
import styles from './ForgeTrayActionButton.module.css';

type ForgeTrayActionButtonSize = 'compact' | 'card' | 'panel';

interface ForgeTrayActionButtonProps {
  added?: boolean;
  className?: string;
  onClick?: () => void;
  size?: ForgeTrayActionButtonSize;
  subjectName?: string;
}

const cx = (...values: Array<string | false | undefined>) => values.filter(Boolean).join(' ');

function getLabel(added: boolean, subjectName?: string) {
  if (subjectName) {
    return added ? `${subjectName} is in Forge Tray` : `Add ${subjectName} to Forge Tray`;
  }
  return added ? 'In Forge Tray' : 'Add to Forge Tray';
}

export function ForgeTrayActionButton({
  added = false,
  className,
  onClick,
  size = 'compact',
  subjectName,
}: ForgeTrayActionButtonProps) {
  const label = getLabel(added, subjectName);

  return (
    <IconButton
      className={cx(styles.button, styles[size], added && styles.added, className)}
      disabled={added}
      onClick={onClick}
      title={label}
      aria-label={label}
      variant="ghost"
      size="sm"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        {added ? (
          <path d="m5 12 4 4L19 6" />
        ) : (
          <>
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </>
        )}
      </svg>
    </IconButton>
  );
}

export default ForgeTrayActionButton;
