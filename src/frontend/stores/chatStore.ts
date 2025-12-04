import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { useCallback } from 'react';
import type { AssistantPlan, PlanStep, PendingApproval, AutoExecutedAction } from '../../api/types';
import type {
  Plan as ServerPlan,
  PlanStep as ServerPlanStep,
  PendingApproval as ServerApproval,
  AutoExecuted as ServerAutoExecuted,
} from '../hooks/useSpaceWebSocket';

// =============================================================================
// Types
// =============================================================================

/**
 * Chat message stored in session history
 *
 * @see LimitErrorResponse in api/types.ts for billing error structure
 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  isError?: boolean;
  retryPayload?: { message: string; mode: 'advisor' | 'actor' };
  // Optional thumbnail for showing generated assets
  thumbnail?: {
    url: string;
    assetName: string;
    assetId?: string;
  };
  /**
   * Quota exceeded error (HTTP 402)
   * UI should show upgrade CTA and link to /api/billing/portal
   * @see LimitErrorResponse.denyReason === 'quota_exceeded'
   */
  quotaError?: {
    service: string;
    used: number;
    limit: number | null;
  };
  /**
   * Rate limit error (HTTP 429)
   * UI should show countdown timer until resetsAt
   * @see LimitErrorResponse.denyReason === 'rate_limited'
   */
  rateLimitError?: {
    resetsAt: string | null;  // ISO date string
    remainingSeconds: number;
  };
}

export type PlanStatus = 'idle' | 'awaiting_approval' | 'executing' | 'paused' | 'completed' | 'failed';

export interface ChatSession {
  messages: ChatMessage[];
  inputBuffer: string;
  mode: 'advisor' | 'actor';
  plan: AssistantPlan | null;
  planStatus: PlanStatus;
  planError?: string;
  isOpen: boolean;
  showPreferencesPanel: boolean;
  lastUpdated: number;
  /** Pending approvals for generating tools (trust zones) */
  pendingApprovals: PendingApproval[];
  /** Results of auto-executed safe tools (trust zones) */
  lastAutoExecuted: AutoExecutedAction[];
}

interface ChatState {
  // Sessions by spaceId
  sessions: Record<string, ChatSession>;

  // Actions
  getSession: (spaceId: string) => ChatSession;
  setMessages: (spaceId: string, messages: ChatMessage[]) => void;
  addMessage: (spaceId: string, message: Omit<ChatMessage, 'id'>) => void;
  clearMessages: (spaceId: string) => void;
  setInputBuffer: (spaceId: string, value: string) => void;
  setMode: (spaceId: string, mode: 'advisor' | 'actor') => void;
  setIsOpen: (spaceId: string, isOpen: boolean) => void;
  setShowPreferencesPanel: (spaceId: string, show: boolean) => void;

  // Plan actions
  setPlan: (spaceId: string, plan: AssistantPlan) => void;
  approvePlan: (spaceId: string) => void;
  rejectPlan: (spaceId: string) => void;
  startStep: (spaceId: string, stepIndex: number) => void;
  completeStep: (spaceId: string, stepIndex: number, result: string) => void;
  failStep: (spaceId: string, stepIndex: number, error: string) => void;
  cancelPlan: (spaceId: string) => void;
  resetPlan: (spaceId: string) => void;

  // Trust zone actions
  setPendingApprovals: (spaceId: string, approvals: PendingApproval[]) => void;
  approveApproval: (spaceId: string, approvalId: string) => PendingApproval | undefined;
  rejectApproval: (spaceId: string, approvalId: string) => void;
  clearPendingApprovals: (spaceId: string) => void;
  setLastAutoExecuted: (spaceId: string, actions: AutoExecutedAction[]) => void;

  // Server sync actions (server-first approach)
  syncServerPlan: (spaceId: string, plan: ServerPlan, steps: ServerPlanStep[]) => void;
  updateServerPlan: (spaceId: string, plan: ServerPlan) => void;
  updateServerPlanStep: (spaceId: string, step: ServerPlanStep) => void;
  syncServerApproval: (spaceId: string, approval: ServerApproval) => void;
  updateServerApproval: (spaceId: string, approval: ServerApproval) => void;
  syncServerApprovals: (spaceId: string, approvals: ServerApproval[]) => void;
  syncServerAutoExecuted: (spaceId: string, autoExecuted: ServerAutoExecuted) => void;
}

// =============================================================================
// Helpers
// =============================================================================

const createEmptySession = (): ChatSession => ({
  messages: [],
  inputBuffer: '',
  mode: 'actor',
  plan: null,
  planStatus: 'idle',
  isOpen: false,
  showPreferencesPanel: false,
  lastUpdated: Date.now(),
  pendingApprovals: [],
  lastAutoExecuted: [],
});

const generateMessageId = (): string => {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
};

// Convert server plan status to client status (cancelled maps to failed for display)
const serverPlanStatusToClient = (status: ServerPlan['status']): AssistantPlan['status'] => {
  if (status === 'cancelled') return 'failed'; // Cancelled plans are treated as failed in client
  return status;
};

// Convert server plan to client plan
const serverPlanToClient = (plan: ServerPlan, steps: ServerPlanStep[]): AssistantPlan => ({
  id: plan.id,
  goal: plan.goal,
  currentStepIndex: plan.current_step_index,
  status: serverPlanStatusToClient(plan.status),
  createdAt: plan.created_at,
  steps: steps.map(s => ({
    id: s.id,
    description: s.description,
    action: s.action,
    params: JSON.parse(s.params) as Record<string, unknown>,
    status: s.status,
    result: s.result ?? undefined,
    error: s.error ?? undefined,
  })),
});

// Convert server approval to client approval
const serverApprovalToClient = (approval: ServerApproval): PendingApproval => ({
  id: approval.id,
  tool: approval.tool,
  params: JSON.parse(approval.params) as Record<string, unknown>,
  description: approval.description,
  status: approval.status === 'pending' ? 'pending' : approval.status === 'approved' ? 'approved' : 'rejected',
  createdAt: approval.created_at,
});

// Convert server auto-executed to client
const serverAutoExecutedToClient = (autoExec: ServerAutoExecuted): AutoExecutedAction => ({
  tool: autoExec.tool,
  params: JSON.parse(autoExec.params) as Record<string, unknown>,
  result: JSON.parse(autoExec.result) as unknown,
  success: autoExec.success,
  error: autoExec.error ?? undefined,
});

const updateStepStatus = (
  plan: AssistantPlan,
  stepIndex: number,
  updates: Partial<PlanStep>
): AssistantPlan => {
  return {
    ...plan,
    currentStepIndex: stepIndex,
    steps: plan.steps.map((s, i) =>
      i === stepIndex ? { ...s, ...updates } : s
    ),
  };
};

// =============================================================================
// Store
// =============================================================================

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      sessions: {},

      getSession: (spaceId) => {
        const session = get().sessions[spaceId];
        return session || createEmptySession();
      },

      setMessages: (spaceId, messages) => {
        set((state) => ({
          sessions: {
            ...state.sessions,
            [spaceId]: {
              ...(state.sessions[spaceId] || createEmptySession()),
              messages,
              lastUpdated: Date.now(),
            },
          },
        }));
      },

      addMessage: (spaceId, message) => {
        set((state) => {
          const session = state.sessions[spaceId] || createEmptySession();
          return {
            sessions: {
              ...state.sessions,
              [spaceId]: {
                ...session,
                messages: [...session.messages, { ...message, id: generateMessageId() }],
                lastUpdated: Date.now(),
              },
            },
          };
        });
      },

      clearMessages: (spaceId) => {
        set((state) => ({
          sessions: {
            ...state.sessions,
            [spaceId]: {
              ...(state.sessions[spaceId] || createEmptySession()),
              messages: [],
              plan: null,
              planStatus: 'idle',
              planError: undefined,
              pendingApprovals: [],
              lastAutoExecuted: [],
              lastUpdated: Date.now(),
            },
          },
        }));
      },

      setInputBuffer: (spaceId, value) => {
        set((state) => ({
          sessions: {
            ...state.sessions,
            [spaceId]: {
              ...(state.sessions[spaceId] || createEmptySession()),
              inputBuffer: value,
              lastUpdated: Date.now(),
            },
          },
        }));
      },

      setMode: (spaceId, mode) => {
        set((state) => ({
          sessions: {
            ...state.sessions,
            [spaceId]: {
              ...(state.sessions[spaceId] || createEmptySession()),
              mode,
              lastUpdated: Date.now(),
            },
          },
        }));
      },

      setIsOpen: (spaceId, isOpen) => {
        set((state) => ({
          sessions: {
            ...state.sessions,
            [spaceId]: {
              ...(state.sessions[spaceId] || createEmptySession()),
              isOpen,
              lastUpdated: Date.now(),
            },
          },
        }));
      },

      setShowPreferencesPanel: (spaceId, show) => {
        set((state) => ({
          sessions: {
            ...state.sessions,
            [spaceId]: {
              ...(state.sessions[spaceId] || createEmptySession()),
              showPreferencesPanel: show,
              lastUpdated: Date.now(),
            },
          },
        }));
      },

      // Plan actions
      setPlan: (spaceId, plan) => {
        set((state) => ({
          sessions: {
            ...state.sessions,
            [spaceId]: {
              ...(state.sessions[spaceId] || createEmptySession()),
              plan: { ...plan, status: 'planning' },
              planStatus: 'awaiting_approval',
              planError: undefined,
              lastUpdated: Date.now(),
            },
          },
        }));
      },

      approvePlan: (spaceId) => {
        set((state) => {
          const session = state.sessions[spaceId];
          if (!session || session.planStatus !== 'awaiting_approval' || !session.plan) {
            return state;
          }
          return {
            sessions: {
              ...state.sessions,
              [spaceId]: {
                ...session,
                plan: { ...session.plan, status: 'executing' },
                planStatus: 'executing',
                lastUpdated: Date.now(),
              },
            },
          };
        });
      },

      rejectPlan: (spaceId) => {
        set((state) => {
          const session = state.sessions[spaceId];
          if (!session || session.planStatus !== 'awaiting_approval') {
            return state;
          }
          return {
            sessions: {
              ...state.sessions,
              [spaceId]: {
                ...session,
                plan: null,
                planStatus: 'idle',
                lastUpdated: Date.now(),
              },
            },
          };
        });
      },

      startStep: (spaceId, stepIndex) => {
        set((state) => {
          const session = state.sessions[spaceId];
          if (!session || !session.plan || (session.planStatus !== 'executing' && session.planStatus !== 'paused')) {
            return state;
          }
          return {
            sessions: {
              ...state.sessions,
              [spaceId]: {
                ...session,
                plan: updateStepStatus(session.plan, stepIndex, { status: 'in_progress' }),
                planStatus: 'executing',
                lastUpdated: Date.now(),
              },
            },
          };
        });
      },

      completeStep: (spaceId, stepIndex, result) => {
        set((state) => {
          const session = state.sessions[spaceId];
          if (!session || !session.plan || session.planStatus !== 'executing') {
            return state;
          }

          const updatedPlan = updateStepStatus(session.plan, stepIndex, {
            status: 'completed',
            result,
          });

          // Check if all steps are done
          const remainingSteps = updatedPlan.steps.filter(s => s.status === 'pending').length;
          const newStatus: PlanStatus = remainingSteps === 0 ? 'completed' : 'paused';

          return {
            sessions: {
              ...state.sessions,
              [spaceId]: {
                ...session,
                plan: { ...updatedPlan, status: newStatus === 'completed' ? 'completed' : 'paused' },
                planStatus: newStatus,
                lastUpdated: Date.now(),
              },
            },
          };
        });
      },

      failStep: (spaceId, stepIndex, error) => {
        set((state) => {
          const session = state.sessions[spaceId];
          if (!session || !session.plan || session.planStatus !== 'executing') {
            return state;
          }

          const failedPlan = updateStepStatus(session.plan, stepIndex, {
            status: 'failed',
            error,
          });

          return {
            sessions: {
              ...state.sessions,
              [spaceId]: {
                ...session,
                plan: { ...failedPlan, status: 'failed' },
                planStatus: 'failed',
                planError: error,
                lastUpdated: Date.now(),
              },
            },
          };
        });
      },

      cancelPlan: (spaceId) => {
        set((state) => {
          const session = state.sessions[spaceId];
          if (!session || session.planStatus === 'idle') {
            return state;
          }
          return {
            sessions: {
              ...state.sessions,
              [spaceId]: {
                ...session,
                plan: null,
                planStatus: 'idle',
                planError: undefined,
                lastUpdated: Date.now(),
              },
            },
          };
        });
      },

      resetPlan: (spaceId) => {
        set((state) => ({
          sessions: {
            ...state.sessions,
            [spaceId]: {
              ...(state.sessions[spaceId] || createEmptySession()),
              plan: null,
              planStatus: 'idle',
              planError: undefined,
              lastUpdated: Date.now(),
            },
          },
        }));
      },

      // Trust zone actions
      setPendingApprovals: (spaceId, approvals) => {
        set((state) => ({
          sessions: {
            ...state.sessions,
            [spaceId]: {
              ...(state.sessions[spaceId] || createEmptySession()),
              pendingApprovals: approvals,
              lastUpdated: Date.now(),
            },
          },
        }));
      },

      approveApproval: (spaceId, approvalId) => {
        const session = get().sessions[spaceId];
        if (!session) return undefined;

        const approval = session.pendingApprovals.find(a => a.id === approvalId);
        if (!approval) return undefined;

        set((state) => ({
          sessions: {
            ...state.sessions,
            [spaceId]: {
              ...session,
              pendingApprovals: session.pendingApprovals.map(a =>
                a.id === approvalId ? { ...a, status: 'approved' as const } : a
              ),
              lastUpdated: Date.now(),
            },
          },
        }));

        return approval;
      },

      rejectApproval: (spaceId, approvalId) => {
        set((state) => {
          const session = state.sessions[spaceId];
          if (!session) return state;

          return {
            sessions: {
              ...state.sessions,
              [spaceId]: {
                ...session,
                pendingApprovals: session.pendingApprovals.map(a =>
                  a.id === approvalId ? { ...a, status: 'rejected' as const } : a
                ),
                lastUpdated: Date.now(),
              },
            },
          };
        });
      },

      clearPendingApprovals: (spaceId) => {
        set((state) => ({
          sessions: {
            ...state.sessions,
            [spaceId]: {
              ...(state.sessions[spaceId] || createEmptySession()),
              pendingApprovals: [],
              lastUpdated: Date.now(),
            },
          },
        }));
      },

      setLastAutoExecuted: (spaceId, actions) => {
        set((state) => ({
          sessions: {
            ...state.sessions,
            [spaceId]: {
              ...(state.sessions[spaceId] || createEmptySession()),
              lastAutoExecuted: actions,
              lastUpdated: Date.now(),
            },
          },
        }));
      },

      // Server sync actions (server-first approach)
      syncServerPlan: (spaceId, plan, steps) => {
        const clientPlan = serverPlanToClient(plan, steps);
        const planStatus = plan.status === 'planning' ? 'awaiting_approval' :
          plan.status === 'executing' ? 'executing' :
          plan.status === 'paused' ? 'paused' :
          plan.status === 'completed' ? 'completed' :
          plan.status === 'failed' ? 'failed' : 'idle';

        set((state) => ({
          sessions: {
            ...state.sessions,
            [spaceId]: {
              ...(state.sessions[spaceId] || createEmptySession()),
              plan: clientPlan,
              planStatus,
              planError: undefined,
              lastUpdated: Date.now(),
            },
          },
        }));
      },

      updateServerPlan: (spaceId, plan) => {
        set((state) => {
          const session = state.sessions[spaceId];
          if (!session || !session.plan) return state;

          const planStatus = plan.status === 'planning' ? 'awaiting_approval' :
            plan.status === 'executing' ? 'executing' :
            plan.status === 'paused' ? 'paused' :
            plan.status === 'completed' ? 'completed' :
            plan.status === 'failed' ? 'failed' :
            plan.status === 'cancelled' ? 'idle' : 'idle';

          return {
            sessions: {
              ...state.sessions,
              [spaceId]: {
                ...session,
                plan: plan.status === 'cancelled' ? null : {
                  ...session.plan,
                  status: plan.status,
                  currentStepIndex: plan.current_step_index,
                },
                planStatus,
                lastUpdated: Date.now(),
              },
            },
          };
        });
      },

      updateServerPlanStep: (spaceId, step) => {
        set((state) => {
          const session = state.sessions[spaceId];
          if (!session || !session.plan) return state;

          return {
            sessions: {
              ...state.sessions,
              [spaceId]: {
                ...session,
                plan: {
                  ...session.plan,
                  steps: session.plan.steps.map(s =>
                    s.id === step.id ? {
                      ...s,
                      status: step.status,
                      result: step.result ?? undefined,
                      error: step.error ?? undefined,
                    } : s
                  ),
                },
                lastUpdated: Date.now(),
              },
            },
          };
        });
      },

      syncServerApproval: (spaceId, approval) => {
        const clientApproval = serverApprovalToClient(approval);
        set((state) => {
          const session = state.sessions[spaceId] || createEmptySession();
          const existing = session.pendingApprovals.findIndex(a => a.id === approval.id);

          return {
            sessions: {
              ...state.sessions,
              [spaceId]: {
                ...session,
                pendingApprovals: existing >= 0
                  ? session.pendingApprovals.map((a, i) => i === existing ? clientApproval : a)
                  : [...session.pendingApprovals, clientApproval],
                lastUpdated: Date.now(),
              },
            },
          };
        });
      },

      updateServerApproval: (spaceId, approval) => {
        set((state) => {
          const session = state.sessions[spaceId];
          if (!session) return state;

          return {
            sessions: {
              ...state.sessions,
              [spaceId]: {
                ...session,
                pendingApprovals: session.pendingApprovals.map(a =>
                  a.id === approval.id ? serverApprovalToClient(approval) : a
                ),
                lastUpdated: Date.now(),
              },
            },
          };
        });
      },

      syncServerApprovals: (spaceId, approvals) => {
        set((state) => ({
          sessions: {
            ...state.sessions,
            [spaceId]: {
              ...(state.sessions[spaceId] || createEmptySession()),
              pendingApprovals: approvals.map(serverApprovalToClient),
              lastUpdated: Date.now(),
            },
          },
        }));
      },

      syncServerAutoExecuted: (spaceId, autoExecuted) => {
        const clientAutoExec = serverAutoExecutedToClient(autoExecuted);
        set((state) => {
          const session = state.sessions[spaceId] || createEmptySession();
          return {
            sessions: {
              ...state.sessions,
              [spaceId]: {
                ...session,
                lastAutoExecuted: [...session.lastAutoExecuted, clientAutoExec],
                lastUpdated: Date.now(),
              },
            },
          };
        });
      },
    }),
    {
      name: 'chat-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        // Only persist sessions, not the actions
        sessions: state.sessions,
      }),
      // Migrate old data if needed
      version: 1,
    }
  )
);

// =============================================================================
// Stable references to avoid re-renders
// =============================================================================

const emptyMessages: ChatMessage[] = [];
const emptyApprovals: PendingApproval[] = [];
const emptyAutoExecuted: AutoExecutedAction[] = [];
const defaultSession: ChatSession = {
  messages: emptyMessages,
  inputBuffer: '',
  mode: 'actor',
  plan: null,
  planStatus: 'idle',
  isOpen: false,
  showPreferencesPanel: false,
  lastUpdated: 0,
  pendingApprovals: emptyApprovals,
  lastAutoExecuted: emptyAutoExecuted,
};

// =============================================================================
// Hooks for accessing session data (with stable selector references)
// =============================================================================

export function useChatSession(spaceId: string) {
  const selector = useCallback(
    (state: ChatState) => state.sessions[spaceId] ?? defaultSession,
    [spaceId]
  );
  return useChatStore(selector);
}

export function useChatMessages(spaceId: string) {
  const selector = useCallback(
    (state: ChatState) => state.sessions[spaceId]?.messages ?? emptyMessages,
    [spaceId]
  );
  return useChatStore(selector);
}

export function useChatInputBuffer(spaceId: string) {
  const selector = useCallback(
    (state: ChatState) => state.sessions[spaceId]?.inputBuffer ?? '',
    [spaceId]
  );
  return useChatStore(selector);
}

export function useChatMode(spaceId: string) {
  const selector = useCallback(
    (state: ChatState) => state.sessions[spaceId]?.mode ?? 'actor',
    [spaceId]
  );
  return useChatStore(selector);
}

export function useChatPlan(spaceId: string) {
  const selector = useCallback(
    (state: ChatState) => state.sessions[spaceId]?.plan ?? null,
    [spaceId]
  );
  return useChatStore(selector);
}

export function useChatPlanStatus(spaceId: string) {
  const selector = useCallback(
    (state: ChatState) => state.sessions[spaceId]?.planStatus ?? 'idle',
    [spaceId]
  );
  return useChatStore(selector);
}

export function useChatIsOpen(spaceId: string) {
  const selector = useCallback(
    (state: ChatState) => state.sessions[spaceId]?.isOpen ?? false,
    [spaceId]
  );
  return useChatStore(selector);
}

export function useShowPreferencesPanel(spaceId: string) {
  const selector = useCallback(
    (state: ChatState) => state.sessions[spaceId]?.showPreferencesPanel ?? false,
    [spaceId]
  );
  return useChatStore(selector);
}

export function usePendingApprovals(spaceId: string) {
  const selector = useCallback(
    (state: ChatState) => state.sessions[spaceId]?.pendingApprovals ?? emptyApprovals,
    [spaceId]
  );
  return useChatStore(selector);
}

export function useLastAutoExecuted(spaceId: string) {
  const selector = useCallback(
    (state: ChatState) => state.sessions[spaceId]?.lastAutoExecuted ?? emptyAutoExecuted,
    [spaceId]
  );
  return useChatStore(selector);
}
