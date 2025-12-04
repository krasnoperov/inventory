import { useState } from 'react';
import type { AssistantPlan, PlanStep } from '../../../api/types';
import styles from './ChatSidebar.module.css';

// =============================================================================
// Types
// =============================================================================

/**
 * Plan state machine types for PlanPanel display
 */
export type PlanState =
  | { status: 'idle' }
  | { status: 'awaiting_approval'; plan: AssistantPlan }
  | { status: 'executing'; plan: AssistantPlan; currentStep: number }
  | { status: 'paused'; plan: AssistantPlan; currentStep: number }
  | { status: 'completed'; plan: AssistantPlan }
  | { status: 'failed'; plan: AssistantPlan; error: string };

export interface PlanPanelProps {
  planState: PlanState;
  isExecuting: boolean;
  onApprove: (autoAdvance: boolean) => void;
  onReject: () => void;
  onContinue: () => void;
  onCancel: () => void;
  onSkipStep?: (stepId: string) => void;
  onRetryStep?: (stepId: string) => void;
  onSetAutoAdvance?: (autoAdvance: boolean) => void;
}

// =============================================================================
// Helpers
// =============================================================================

/** Get status icon for a plan step */
function getStepIcon(step: PlanStep): string {
  switch (step.status) {
    case 'completed': return '✓';
    case 'failed': return '✗';
    case 'in_progress': return '⏳';
    case 'skipped': return '⏭';
    case 'blocked': return '🔒';
    default: return '';
  }
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
  onSkipStep,
  onRetryStep,
  onSetAutoAdvance,
}: PlanPanelProps) {
  const [autoAdvance, setAutoAdvance] = useState(false);

  // Don't render if idle or completed
  if (planState.status === 'idle' || planState.status === 'completed') {
    return null;
  }

  const plan = planState.plan;
  const isPaused = planState.status === 'paused';
  const isAwaitingApproval = planState.status === 'awaiting_approval';

  // Check for failed or blocked steps (for showing retry/skip actions)
  const failedStep = plan.steps.find(s => s.status === 'failed');
  const blockedSteps = plan.steps.filter(s => s.status === 'blocked');
  const hasBlockedSteps = blockedSteps.length > 0;

  const handleApprove = () => {
    onApprove(autoAdvance);
  };

  const handleAutoAdvanceChange = (checked: boolean) => {
    setAutoAdvance(checked);
    // Also update on server if plan is already executing
    if (!isAwaitingApproval && onSetAutoAdvance) {
      onSetAutoAdvance(checked);
    }
  };

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
            <span className={styles.stepDescription}>
              {step.description}
              {step.error && (
                <span className={styles.stepError} title={step.error}>
                  {' '}({step.error.slice(0, 30)}...)
                </span>
              )}
            </span>
            {getStepIcon(step) && (
              <span className={styles.stepIcon}>{getStepIcon(step)}</span>
            )}
            {/* Skip/Retry actions for failed steps */}
            {step.status === 'failed' && isPaused && (
              <span className={styles.stepActions}>
                {onRetryStep && (
                  <button
                    className={styles.stepActionBtn}
                    onClick={() => onRetryStep(step.id)}
                    disabled={isExecuting}
                    title="Retry this step"
                  >
                    ↻
                  </button>
                )}
                {onSkipStep && (
                  <button
                    className={styles.stepActionBtn}
                    onClick={() => onSkipStep(step.id)}
                    disabled={isExecuting}
                    title="Skip this step"
                  >
                    ⏭
                  </button>
                )}
              </span>
            )}
            {/* Skip action for blocked steps */}
            {step.status === 'blocked' && isPaused && onSkipStep && (
              <span className={styles.stepActions}>
                <button
                  className={styles.stepActionBtn}
                  onClick={() => onSkipStep(step.id)}
                  disabled={isExecuting}
                  title="Skip this blocked step"
                >
                  ⏭
                </button>
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Initial approval with auto-advance toggle */}
      {isAwaitingApproval && (
        <div className={styles.planActions}>
          <label className={styles.autoAdvanceLabel}>
            <input
              type="checkbox"
              checked={autoAdvance}
              onChange={(e) => handleAutoAdvanceChange((e.target as HTMLInputElement).checked)}
              disabled={isExecuting}
            />
            <span>Auto-advance steps</span>
          </label>
          <div className={styles.planButtonRow}>
            <button
              className={styles.planApprove}
              onClick={handleApprove}
              disabled={isExecuting}
            >
              {autoAdvance ? 'Start (Auto)' : 'Start Plan'}
            </button>
            <button
              className={styles.planCancel}
              onClick={onReject}
              disabled={isExecuting}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Step-by-step controls when paused */}
      {isPaused && (
        <div className={styles.stepControls}>
          {/* Show status message for blocked/failed */}
          {(hasBlockedSteps || failedStep) && (
            <div className={styles.planWarning}>
              {failedStep
                ? `Step failed: ${failedStep.description}. Retry or skip to continue.`
                : `${blockedSteps.length} step(s) blocked. Skip failed dependency or retry.`}
            </div>
          )}
          {/* Auto-advance toggle */}
          {onSetAutoAdvance && (
            <label className={styles.autoAdvanceLabel}>
              <input
                type="checkbox"
                checked={plan.autoAdvance || false}
                onChange={(e) => onSetAutoAdvance((e.target as HTMLInputElement).checked)}
                disabled={isExecuting}
              />
              <span>Auto-advance</span>
            </label>
          )}
          <button
            className={styles.nextStepButton}
            onClick={onContinue}
            disabled={isExecuting || (!plan.autoAdvance && !failedStep && !hasBlockedSteps ? false : true)}
          >
            {failedStep ? 'Retry Failed' : hasBlockedSteps ? 'Skip Blocked' : 'Next Step →'}
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
          {/* Auto-advance toggle even during execution */}
          {onSetAutoAdvance && (
            <label className={styles.autoAdvanceLabel}>
              <input
                type="checkbox"
                checked={plan.autoAdvance || false}
                onChange={(e) => onSetAutoAdvance((e.target as HTMLInputElement).checked)}
              />
              <span>Auto-advance</span>
            </label>
          )}
          <button className={styles.planApprove} disabled>
            {plan.autoAdvance ? 'Auto-executing...' : 'Executing...'}
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
