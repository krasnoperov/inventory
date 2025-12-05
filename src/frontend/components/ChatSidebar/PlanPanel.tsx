import type { SimplePlan } from '../../../shared/websocket-types';
import { MarkdownRenderer } from './MarkdownRenderer';
import styles from './ChatSidebar.module.css';

// =============================================================================
// Types
// =============================================================================

export interface PlanPanelProps {
  /** The active plan (markdown content) */
  plan: SimplePlan | null;
  /** Callback to clear/archive the plan */
  onClear?: () => void;
}

// =============================================================================
// Component
// =============================================================================

/**
 * Simple markdown-based plan display.
 * Claude can update the plan content via update_plan tool.
 * The plan is displayed with full markdown rendering.
 */
export function PlanPanel({ plan, onClear }: PlanPanelProps) {
  // Don't render if no plan or plan is archived
  if (!plan || plan.status === 'archived') {
    return null;
  }

  return (
    <div className={styles.planCard}>
      <div className={styles.planHeader}>
        <span className={styles.planIcon}>📋</span>
        <span className={styles.planGoal}>Plan</span>
        <span className={`${styles.planStatus} ${styles[plan.status]}`}>
          {plan.status}
        </span>
        {onClear && (
          <button
            className={styles.planDismiss}
            onClick={onClear}
            title="Clear plan"
          >
            ✕
          </button>
        )}
      </div>

      <div className={styles.planContent}>
        <MarkdownRenderer
          content={plan.content}
          maxCollapsedHeight={200}
        />
      </div>
    </div>
  );
}
