import { IconButton } from '../ui';
import styles from './OpenAssetActionButton.module.css';

interface OpenAssetActionButtonProps {
  className?: string;
  onClick: () => void;
  subjectName: string;
}

const cx = (...values: Array<string | false | undefined>) => values.filter(Boolean).join(' ');

export function OpenAssetActionButton({
  className,
  onClick,
  subjectName,
}: OpenAssetActionButtonProps) {
  const label = `Open ${subjectName} details`;

  return (
    <IconButton
      className={cx(styles.button, className)}
      onClick={onClick}
      title={label}
      aria-label={label}
      variant="ghost"
      size="sm"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M7 17 17 7" />
        <path d="M9 7h8v8" />
      </svg>
    </IconButton>
  );
}

export default OpenAssetActionButton;
