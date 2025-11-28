import type { PlanState } from './hooks/usePlanState';
import styles from './ChatSidebar.module.css';

// =============================================================================
// Types
// =============================================================================

export interface PlanPanelProps {
  planState: PlanState;
  isExecuting: boolean;
  onApprove: () => void;
  onReject: () => void;
  onContinue: () => void;
  onCancel: () => void;
}

// =============================================================================
// Component
// =============================================================================

export function PlanPanel({
  planState,
  isExecuting,
  onApprove,
  onReject,
  onContinue,
  onCancel,
}: PlanPanelProps) {
  // Don't render if idle or completed
  if (planState.status === 'idle' || planState.status === 'completed') {
    return null;
  }

  const plan = planState.plan;
  const isPaused = planState.status === 'paused';
  const isAwaitingApproval = planState.status === 'awaiting_approval';

  return (
    <div className={styles.planCard}>
      <div className={styles.planHeader}>
        <span className={styles.planIcon}>📋</span>
        <span className={styles.planGoal}>{plan.goal}</span>
        <span className={`${styles.planStatus} ${styles[plan.status]}`}>
          {plan.status}
        </span>
      </div>

      <div className={styles.planSteps}>
        {plan.steps.map((step, idx) => (
          <div
            key={step.id}
            className={`${styles.planStep} ${styles[step.status]}`}
          >
            <span className={styles.stepNumber}>{idx + 1}</span>
            <span className={styles.stepDescription}>{step.description}</span>
            {step.status === 'completed' && <span className={styles.stepIcon}>✓</span>}
            {step.status === 'failed' && <span className={styles.stepIcon}>✗</span>}
            {step.status === 'in_progress' && <span className={styles.stepIcon}>⏳</span>}
          </div>
        ))}
      </div>

      {/* Initial approval buttons */}
      {isAwaitingApproval && (
        <div className={styles.planActions}>
          <button
            className={styles.planApprove}
            onClick={onApprove}
            disabled={isExecuting}
          >
            Start Plan
          </button>
          <button
            className={styles.planCancel}
            onClick={onReject}
            disabled={isExecuting}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Step-by-step controls when paused */}
      {isPaused && (
        <div className={styles.stepControls}>
          <button
            className={styles.nextStepButton}
            onClick={onContinue}
            disabled={isExecuting}
          >
            Next Step →
          </button>
          <button
            className={styles.pauseButton}
            onClick={onCancel}
            disabled={isExecuting}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Executing indicator */}
      {planState.status === 'executing' && (
        <div className={styles.planActions}>
          <button className={styles.planApprove} disabled>
            Executing...
          </button>
        </div>
      )}

      {/* Failed state */}
      {planState.status === 'failed' && (
        <div className={styles.planActions}>
          <button
            className={styles.planCancel}
            onClick={onCancel}
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
