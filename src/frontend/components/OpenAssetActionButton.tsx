import { CanvasActionButton } from './CanvasActionButton';

interface OpenAssetActionButtonProps {
  className?: string;
  onClick: () => void;
  subjectName: string;
}

export function OpenAssetActionButton({
  className,
  onClick,
  subjectName,
}: OpenAssetActionButtonProps) {
  const label = `Open ${subjectName} details`;

  return (
    <CanvasActionButton
      className={className}
      label={label}
      onClick={onClick}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M7 17 17 7" />
        <path d="M9 7h8v8" />
      </svg>
    </CanvasActionButton>
  );
}

export default OpenAssetActionButton;
