import styles from './ChatSidebar.module.css';

// =============================================================================
// Types
// =============================================================================

export interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onClear: () => void;
  mode: 'advisor' | 'actor';
  onModeChange: (mode: 'advisor' | 'actor') => void;
  disabled: boolean;
  showClear: boolean;
}

// =============================================================================
// Component
// =============================================================================

export function ChatInput({
  value,
  onChange,
  onSend,
  onClear,
  mode,
  onModeChange,
  disabled,
  showClear,
}: ChatInputProps) {
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <>
      {/* Mode selector */}
      <div className={styles.modeSelector}>
        <button
          className={`${styles.modeButton} ${mode === 'advisor' ? styles.active : ''}`}
          onClick={() => onModeChange('advisor')}
        >
          Advisor
        </button>
        <button
          className={`${styles.modeButton} ${mode === 'actor' ? styles.active : ''}`}
          onClick={() => onModeChange('actor')}
        >
          Actor
        </button>
      </div>
      <p className={styles.modeHint}>
        {mode === 'advisor'
          ? 'Ask questions and get suggestions'
          : 'Take action - create, combine, and manage assets'}
      </p>

      {/* Input area */}
      <div className={styles.inputArea}>
        {showClear && (
          <button className={styles.clearButton} onClick={onClear} title="Clear chat">
            Clear
          </button>
        )}
        <div className={styles.inputWrapper}>
          <textarea
            className={styles.input}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder={mode === 'advisor' ? 'Ask a question...' : 'Tell me what to create...'}
            rows={1}
            disabled={disabled}
          />
          <button
            className={styles.sendButton}
            onClick={onSend}
            disabled={disabled || !value.trim()}
          >
            →
          </button>
        </div>
      </div>
    </>
  );
}
