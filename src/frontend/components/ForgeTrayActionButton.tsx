import { CanvasActionButton } from './CanvasActionButton';

type ForgeTrayActionButtonSize = 'compact' | 'card' | 'panel';

interface ForgeTrayActionButtonProps {
  added?: boolean;
  className?: string;
  onClick?: () => void;
  size?: ForgeTrayActionButtonSize;
  subjectName?: string;
}

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
  const chromeSize = size === 'card' ? 'mediaOverlay' : size;

  return (
    <CanvasActionButton
      active={added}
      className={className}
      disabled={added}
      label={label}
      onClick={onClick}
      size={chromeSize}
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
    </CanvasActionButton>
  );
}

export default ForgeTrayActionButton;
