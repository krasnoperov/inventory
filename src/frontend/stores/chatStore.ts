import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { useCallback } from 'react';
import type { PendingApproval, AutoExecutedAction } from '../../api/types';
import type { SimplePlan } from '../../shared/websocket-types';
import type {
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

export interface ChatSession {
  messages: ChatMessage[];
  inputBuffer: string;
  mode: 'advisor' | 'actor';
  /** Simple markdown-based plan (Claude Code style) */
  plan: SimplePlan | null;
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

  // Simple plan actions (markdown-based)
  setPlan: (spaceId: string, plan: SimplePlan) => void;
  clearPlan: (spaceId: string) => void;

  // Trust zone actions
  setPendingApprovals: (spaceId: string, approvals: PendingApproval[]) => void;
  approveApproval: (spaceId: string, approvalId: string) => PendingApproval | undefined;
  rejectApproval: (spaceId: string, approvalId: string) => void;
  clearPendingApprovals: (spaceId: string) => void;
  setLastAutoExecuted: (spaceId: string, actions: AutoExecutedAction[]) => void;

  // Server sync actions
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
  isOpen: false,
  showPreferencesPanel: false,
  lastUpdated: Date.now(),
  pendingApprovals: [],
  lastAutoExecuted: [],
});

const generateMessageId = (): string => {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
};

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

      // Simple plan actions (markdown-based)
      setPlan: (spaceId, plan) => {
        set((state) => ({
          sessions: {
            ...state.sessions,
            [spaceId]: {
              ...(state.sessions[spaceId] || createEmptySession()),
              plan,
              lastUpdated: Date.now(),
            },
          },
        }));
      },

      clearPlan: (spaceId) => {
        set((state) => ({
          sessions: {
            ...state.sessions,
            [spaceId]: {
              ...(state.sessions[spaceId] || createEmptySession()),
              plan: null,
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

      // Server sync actions
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
