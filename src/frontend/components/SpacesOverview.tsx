import type { Space } from '../../api/types';
import { formatUtcDate } from '../lib/dates';
import { Button } from '../ui';
import { Link } from './Link';
import styles from './SpacesOverview.module.css';

interface SpacesOverviewProps {
  spaces: Space[];
  isLoading: boolean;
  emptyDescription: string;
  onCreateSpace: () => void;
}

function roleClassName(role: Space['role']) {
  switch (role) {
    case 'owner':
      return styles.roleOwner;
    case 'editor':
      return styles.roleEditor;
    case 'viewer':
      return styles.roleViewer;
    default:
      return styles.roleDefault;
  }
}

export function SpacesOverview({
  spaces,
  isLoading,
  emptyDescription,
  onCreateSpace,
}: SpacesOverviewProps) {
  if (isLoading) {
    return <div className={styles.loading}>Loading your spaces...</div>;
  }

  if (spaces.length === 0) {
    return (
      <div className={styles.emptyState}>
        <div className={styles.emptyMark} aria-hidden="true">
          <span />
        </div>
        <h2 className={styles.emptyTitle}>No spaces yet</h2>
        <p className={styles.emptyDescription}>{emptyDescription}</p>
        <Button
          className={styles.emptyCreateButton}
          onClick={onCreateSpace}
          variant="primary"
        >
          Create Your First Space
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.spacesList}>
      {spaces.map((space) => (
        <Link
          key={space.id}
          to={`/spaces/${space.id}`}
          className={styles.spaceCard}
        >
          <div className={styles.spaceCardHeader}>
            <h3 className={styles.spaceName}>{space.name}</h3>
            <span className={`${styles.roleBadge} ${roleClassName(space.role)}`}>
              {space.role}
            </span>
          </div>
          <div className={styles.spaceCardFooter}>
            <span className={styles.spaceDate}>
              Created {formatUtcDate(space.created_at)}
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}
