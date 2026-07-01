import { Button, IconButton, TextInput } from '../ui';
import styles from './CreateSpaceDialog.module.css';

export interface CreateSpaceDialogProps {
  isCreating: boolean;
  newSpaceName: string;
  onClose: () => void;
  onNameChange: (value: string) => void;
  onSubmit: () => void;
  surface?: 'app' | 'public';
}

export function CreateSpaceDialog({
  isCreating,
  newSpaceName,
  onClose,
  onNameChange,
  onSubmit,
  surface = 'app',
}: CreateSpaceDialogProps) {
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={`${styles.dialog} ${surface === 'public' ? styles.public : ''}`}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-space-dialog-title"
      >
        <div className={styles.header}>
          <h2 className={styles.title} id="create-space-dialog-title">Create New Space</h2>
          <IconButton
            className={styles.close}
            onClick={onClose}
            aria-label="Close"
            variant="ghost"
            size="sm"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </IconButton>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <div className={styles.formGroup}>
            <label htmlFor="spaceName" className={styles.label}>
              Space Name *
            </label>
            <TextInput
              id="spaceName"
              value={newSpaceName}
              onChange={(event) => onNameChange(event.target.value)}
              className={styles.input}
              placeholder="Enter space name"
              disabled={isCreating}
              autoFocus
              fullWidth
            />
          </div>

          <div className={styles.actions}>
            <Button
              type="button"
              className={styles.action}
              onClick={onClose}
              disabled={isCreating}
              variant="secondary"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className={styles.action}
              disabled={isCreating}
              variant="primary"
            >
              {isCreating ? 'Creating...' : 'Create Space'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
