import { useReducer, useCallback, useMemo } from 'react';
import type { AssistantPlan, PlanStep } from '../../../../api/types';

// =============================================================================
// Plan State Machine Types
// =============================================================================

export type PlanState =
  | { status: 'idle' }
  | { status: 'awaiting_approval'; plan: AssistantPlan }
  | { status: 'executing'; plan: AssistantPlan; currentStep: number }
  | { status: 'paused'; plan: AssistantPlan; currentStep: number }
  | { status: 'completed'; plan: AssistantPlan }
  | { status: 'failed'; plan: AssistantPlan; error: string };

export type PlanAction =
  | { type: 'SET_PLAN'; plan: AssistantPlan }
  | { type: 'APPROVE' }
  | { type: 'REJECT' }
  | { type: 'START_STEP'; stepIndex: number }
  | { type: 'COMPLETE_STEP'; stepIndex: number; result: string }
  | { type: 'FAIL_STEP'; stepIndex: number; error: string }
  | { type: 'PAUSE' }
  | { type: 'CANCEL' }
  | { type: 'RESET' };

// =============================================================================
// Reducer
// =============================================================================

function updateStepStatus(
  plan: AssistantPlan,
  stepIndex: number,
  updates: Partial<PlanStep>
): AssistantPlan {
  return {
    ...plan,
    currentStepIndex: stepIndex,
    steps: plan.steps.map((s, i) =>
      i === stepIndex ? { ...s, ...updates } : s
    ),
  };
}

function planReducer(state: PlanState, action: PlanAction): PlanState {
  switch (action.type) {
    case 'SET_PLAN':
      // New plan arrives - await approval
      return {
        status: 'awaiting_approval',
        plan: { ...action.plan, status: 'planning' },
      };

    case 'APPROVE':
      if (state.status !== 'awaiting_approval') return state;
      return {
        status: 'executing',
        plan: { ...state.plan, status: 'executing' },
        currentStep: 0,
      };

    case 'REJECT':
      if (state.status !== 'awaiting_approval') return state;
      return { status: 'idle' };

    case 'START_STEP':
      if (state.status !== 'executing' && state.status !== 'paused') return state;
      return {
        status: 'executing',
        plan: updateStepStatus(state.plan, action.stepIndex, { status: 'in_progress' }),
        currentStep: action.stepIndex,
      };

    case 'COMPLETE_STEP': {
      if (state.status !== 'executing') return state;
      const updatedPlan = updateStepStatus(state.plan, action.stepIndex, {
        status: 'completed',
        result: action.result,
      });

      // Check if all steps are done
      const remainingSteps = updatedPlan.steps.filter(s => s.status === 'pending').length;
      if (remainingSteps === 0) {
        return {
          status: 'completed',
          plan: { ...updatedPlan, status: 'completed' },
        };
      }

      // More steps - pause for confirmation
      return {
        status: 'paused',
        plan: { ...updatedPlan, status: 'paused' },
        currentStep: action.stepIndex,
      };
    }

    case 'FAIL_STEP': {
      if (state.status !== 'executing') return state;
      const failedPlan = updateStepStatus(state.plan, action.stepIndex, {
        status: 'failed',
        error: action.error,
      });
      return {
        status: 'failed',
        plan: { ...failedPlan, status: 'failed' },
        error: action.error,
      };
    }

    case 'PAUSE':
      if (state.status !== 'executing') return state;
      return {
        status: 'paused',
        plan: { ...state.plan, status: 'paused' },
        currentStep: state.currentStep,
      };

    case 'CANCEL':
      if (state.status === 'idle') return state;
      return { status: 'idle' };

    case 'RESET':
      return { status: 'idle' };

    default:
      return state;
  }
}

// =============================================================================
// Hook
// =============================================================================

export interface UsePlanStateReturn {
  state: PlanState;
  // Computed helpers
  isIdle: boolean;
  isExecuting: boolean;
  isPaused: boolean;
  isAwaitingApproval: boolean;
  activePlan: AssistantPlan | null;
  nextPendingStepIndex: number;
  completedStepCount: number;
  // Actions
  setPlan: (plan: AssistantPlan) => void;
  approve: () => void;
  reject: () => void;
  startStep: (stepIndex: number) => void;
  completeStep: (stepIndex: number, result: string) => void;
  failStep: (stepIndex: number, error: string) => void;
  pause: () => void;
  cancel: () => void;
  reset: () => void;
}

export function usePlanState(): UsePlanStateReturn {
  const [state, dispatch] = useReducer(planReducer, { status: 'idle' });

  // Computed values
  const isIdle = state.status === 'idle';
  const isExecuting = state.status === 'executing';
  const isPaused = state.status === 'paused';
  const isAwaitingApproval = state.status === 'awaiting_approval';

  const activePlan = useMemo(() => {
    if (state.status === 'idle') return null;
    return state.plan;
  }, [state]);

  const nextPendingStepIndex = useMemo(() => {
    if (!activePlan) return -1;
    return activePlan.steps.findIndex(s => s.status === 'pending');
  }, [activePlan]);

  const completedStepCount = useMemo(() => {
    if (!activePlan) return 0;
    return activePlan.steps.filter(s => s.status === 'completed').length;
  }, [activePlan]);

  // Actions
  const setPlan = useCallback((plan: AssistantPlan) => {
    dispatch({ type: 'SET_PLAN', plan });
  }, []);

  const approve = useCallback(() => {
    dispatch({ type: 'APPROVE' });
  }, []);

  const reject = useCallback(() => {
    dispatch({ type: 'REJECT' });
  }, []);

  const startStep = useCallback((stepIndex: number) => {
    dispatch({ type: 'START_STEP', stepIndex });
  }, []);

  const completeStep = useCallback((stepIndex: number, result: string) => {
    dispatch({ type: 'COMPLETE_STEP', stepIndex, result });
  }, []);

  const failStep = useCallback((stepIndex: number, error: string) => {
    dispatch({ type: 'FAIL_STEP', stepIndex, error });
  }, []);

  const pause = useCallback(() => {
    dispatch({ type: 'PAUSE' });
  }, []);

  const cancel = useCallback(() => {
    dispatch({ type: 'CANCEL' });
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: 'RESET' });
  }, []);

  return {
    state,
    isIdle,
    isExecuting,
    isPaused,
    isAwaitingApproval,
    activePlan,
    nextPendingStepIndex,
    completedStepCount,
    setPlan,
    approve,
    reject,
    startStep,
    completeStep,
    failStep,
    pause,
    cancel,
    reset,
  };
}
