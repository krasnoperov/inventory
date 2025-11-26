import { useState, useCallback, useRef, useEffect } from 'react';
import styles from './ChatSidebar.module.css';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: number;
}

interface BotResponse {
  type: 'advice' | 'command';
  message?: string;
  explanation?: string;
  command?: {
    action: string;
    params: Record<string, unknown>;
  };
}

interface ChatSidebarProps {
  spaceId: string;
  isOpen: boolean;
  onClose: () => void;
}

export function ChatSidebar({ spaceId, isOpen, onClose }: ChatSidebarProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [mode, setMode] = useState<'advisor' | 'actor'>('advisor');
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load chat history on mount
  useEffect(() => {
    if (isOpen && spaceId) {
      loadChatHistory();
    }
  }, [isOpen, spaceId]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadChatHistory = async () => {
    try {
      setIsLoadingHistory(true);
      const response = await fetch(`/api/spaces/${spaceId}/chat/history`, {
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json() as { success: boolean; messages: Array<{
          sender_type: 'user' | 'bot';
          content: string;
          created_at: number;
        }> };

        if (data.success && data.messages) {
          const formattedMessages: ChatMessage[] = data.messages.map(msg => ({
            role: msg.sender_type === 'user' ? 'user' : 'assistant',
            content: msg.content,
            timestamp: msg.created_at,
          }));
          setMessages(formattedMessages);
        }
      }
    } catch (err) {
      console.error('Failed to load chat history:', err);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const sendMessage = useCallback(async () => {
    if (!inputValue.trim() || isLoading) return;

    const userMessage = inputValue.trim();
    setInputValue('');
    setIsLoading(true);

    // Add user message to chat
    const newUserMessage: ChatMessage = {
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, newUserMessage]);

    try {
      const response = await fetch(`/api/spaces/${spaceId}/chat`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          mode,
          history: messages.slice(-10).map(m => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json() as { error?: string };
        throw new Error(errorData.error || 'Failed to send message');
      }

      const data = await response.json() as { success: boolean; response: BotResponse };

      // Add bot response to chat
      const botContent = data.response.type === 'advice'
        ? data.response.message || ''
        : data.response.explanation || '';

      const botMessage: ChatMessage = {
        role: 'assistant',
        content: botContent,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, botMessage]);
    } catch (err) {
      console.error('Chat error:', err);
      const errorMessage: ChatMessage = {
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : 'Failed to get response'}`,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  }, [inputValue, isLoading, spaceId, mode, messages]);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = useCallback(() => {
    setMessages([]);
  }, []);

  if (!isOpen) return null;

  return (
    <div className={styles.sidebar}>
      <div className={styles.header}>
        <div className={styles.headerTitle}>
          <span className={styles.botIcon}>🤖</span>
          <h3>Assistant</h3>
        </div>
        <button className={styles.closeButton} onClick={onClose} title="Close chat">
          ×
        </button>
      </div>

      <div className={styles.modeSelector}>
        <button
          className={`${styles.modeButton} ${mode === 'advisor' ? styles.active : ''}`}
          onClick={() => setMode('advisor')}
        >
          Advisor
        </button>
        <button
          className={`${styles.modeButton} ${mode === 'actor' ? styles.active : ''}`}
          onClick={() => setMode('actor')}
        >
          Actor
        </button>
      </div>
      <p className={styles.modeHint}>
        {mode === 'advisor'
          ? 'Ask questions and get suggestions'
          : 'Give commands to modify assets'}
      </p>

      <div className={styles.messages}>
        {isLoadingHistory ? (
          <div className={styles.loadingHistory}>Loading chat history...</div>
        ) : messages.length === 0 ? (
          <div className={styles.emptyChat}>
            <span className={styles.emptyIcon}>💬</span>
            <p>Start a conversation with your AI assistant</p>
            <div className={styles.suggestions}>
              <button onClick={() => setInputValue('What can you help me with?')}>
                What can you help me with?
              </button>
              <button onClick={() => setInputValue('Suggest a character design')}>
                Suggest a character design
              </button>
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`${styles.message} ${styles[msg.role]}`}
              >
                <div className={styles.messageContent}>
                  {msg.content}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className={`${styles.message} ${styles.assistant}`}>
                <div className={styles.messageContent}>
                  <span className={styles.typing}>Thinking...</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      <div className={styles.inputArea}>
        {messages.length > 0 && (
          <button className={styles.clearButton} onClick={clearChat} title="Clear chat">
            Clear
          </button>
        )}
        <div className={styles.inputWrapper}>
          <textarea
            className={styles.input}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder={mode === 'advisor' ? 'Ask a question...' : 'Give a command...'}
            rows={1}
            disabled={isLoading}
          />
          <button
            className={styles.sendButton}
            onClick={sendMessage}
            disabled={isLoading || !inputValue.trim()}
          >
            →
          </button>
        </div>
      </div>
    </div>
  );
}
