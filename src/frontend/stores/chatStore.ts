import { create } from 'zustand';
import type { ChatMessageClient, ForgeChatProgressResult } from '../hooks/useSpaceWebSocket';

interface ChatState {
  // Per-space chat state
  messages: ChatMessageClient[];
  sessionId: string | null;
  isLoading: boolean;
  progress: ForgeChatProgressResult | null;
  error: string | null;
  historyLoaded: boolean; // Track if history was already loaded for this session

  // Actions
  setMessages: (messages: ChatMessageClient[]) => void;
  addMessage: (message: ChatMessageClient) => void;
  replaceTemporaryMessage: (message: ChatMessageClient) => void;
  addTemporaryUserMessage: (content: string) => void;
  setSessionId: (sessionId: string | null) => void;
  setLoading: (isLoading: boolean) => void;
  setProgress: (progress: ForgeChatProgressResult | null) => void;
  setError: (error: string | null) => void;
  setHistoryLoaded: (loaded: boolean) => void;
  clearChat: () => void;
  resetOnDisconnect: () => void;
}

export const useChatStore = create<ChatState>()((set, get) => ({
  messages: [],
  sessionId: null,
  isLoading: false,
  progress: null,
  error: null,
  historyLoaded: false,

  setMessages: (messages) => {
    set({ messages, historyLoaded: true, error: null });
  },

  addMessage: (message) => {
    set((state) => ({
      messages: [...state.messages, message],
      error: null,
    }));
  },

  replaceTemporaryMessage: (message) => {
    // Replace temp messages with the real one from server
    set((state) => ({
      messages: [
        ...state.messages.filter((m) => !m.id.startsWith('temp-')),
        message,
      ],
      error: null,
    }));
  },

  addTemporaryUserMessage: (content) => {
    const tempMessage: ChatMessageClient = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content,
      createdAt: Date.now(),
    };
    set((state) => ({
      messages: [...state.messages, tempMessage],
      isLoading: true,
      error: null,
    }));
  },

  setSessionId: (sessionId) => {
    set({ sessionId });
  },

  setLoading: (isLoading) => {
    set({ isLoading });
  },

  setProgress: (progress) => {
    set({ progress });
  },

  setError: (error) => {
    // Clear loading and progress when error occurs
    set({ error, isLoading: false, progress: null });
  },

  setHistoryLoaded: (loaded) => {
    set({ historyLoaded: loaded });
  },

  clearChat: () => {
    // Clear messages but keep historyLoaded false so next open fetches fresh
    set({
      messages: [],
      sessionId: null,
      isLoading: false,
      progress: null,
      error: null,
      historyLoaded: false,
    });
  },

  resetOnDisconnect: () => {
    // Reset loading states on WebSocket disconnect
    set({
      isLoading: false,
      progress: null,
    });
  },
}));
