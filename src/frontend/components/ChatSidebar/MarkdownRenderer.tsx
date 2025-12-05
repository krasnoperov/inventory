import { useState, useEffect, useCallback, memo, useRef, useSyncExternalStore } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import styles from './MarkdownRenderer.module.css';

// =============================================================================
// Hook for measuring content overflow
// =============================================================================

function useContentOverflow(
  ref: React.RefObject<HTMLDivElement | null>,
  maxHeight: number,
  _content: string // Used to trigger re-measurement when content changes
): boolean {
  // Use a mutable store for the overflow state
  const storeRef = useRef({
    snapshot: false,
    subscribers: new Set<() => void>(),
  });

  const subscribe = useCallback((callback: () => void) => {
    storeRef.current.subscribers.add(callback);
    return () => storeRef.current.subscribers.delete(callback);
  }, []);

  const getSnapshot = useCallback(() => storeRef.current.snapshot, []);

  // Effect to measure and update store (not setting React state directly)
  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const measure = () => {
      const newValue = element.scrollHeight > maxHeight;
      if (storeRef.current.snapshot !== newValue) {
        storeRef.current.snapshot = newValue;
        storeRef.current.subscribers.forEach(cb => cb());
      }
    };

    // Initial measurement
    measure();

    // Observe for size changes
    const observer = new ResizeObserver(measure);
    observer.observe(element);

    return () => observer.disconnect();
  }, [ref, maxHeight, _content]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// =============================================================================
// Types
// =============================================================================

export interface MarkdownRendererProps {
  content: string;
  /** Whether this is a user message (affects typography) */
  isUser?: boolean;
  /** Maximum height before showing "expand" (default: 400px content) */
  maxCollapsedHeight?: number;
  /** Custom class name */
  className?: string;
}

// =============================================================================
// Simple Code Block (no syntax highlighting - lightweight)
// =============================================================================

function CodeBlock({ code }: { code: string }) {
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code);
  }, [code]);

  return (
    <div className={styles.codeBlockWrapper}>
      <button
        className={styles.copyButton}
        onClick={handleCopy}
        title="Copy"
        type="button"
      >
        Copy
      </button>
      <pre className={styles.codeBlock}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

// =============================================================================
// Inline Code
// =============================================================================

function InlineCode({ children }: { children: React.ReactNode }) {
  return <code className={styles.inlineCode}>{children}</code>;
}

// =============================================================================
// Custom Link Component
// =============================================================================

function MarkdownLink({ href, children }: { href?: string; children: React.ReactNode }) {
  const isExternal = href?.startsWith('http');

  return (
    <a
      href={href}
      className={styles.link}
      target={isExternal ? '_blank' : undefined}
      rel={isExternal ? 'noopener noreferrer' : undefined}
    >
      {children}
      {isExternal && <span className={styles.externalIcon}>↗</span>}
    </a>
  );
}

// =============================================================================
// Main Component
// =============================================================================

function MarkdownRendererInner({
  content,
  isUser = false,
  maxCollapsedHeight = 400,
  className,
}: MarkdownRendererProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Check if content exceeds max height using ResizeObserver
  const needsExpansion = useContentOverflow(contentRef, maxCollapsedHeight, content);

  // Custom components for react-markdown
  const components: Components = {
    // Code blocks
    code: ({ className, children, ...props }) => {
      const match = /language-(\w+)/.exec(className || '');
      const isBlock = match || (typeof children === 'string' && children.includes('\n'));

      if (isBlock) {
        const code = String(children).replace(/\n$/, '');
        return <CodeBlock code={code} />;
      }

      return <InlineCode {...props}>{children}</InlineCode>;
    },
    // Links
    a: ({ href, children }) => <MarkdownLink href={href}>{children}</MarkdownLink>,
    // Headers - scale down for chat context
    h1: ({ children }) => <h4 className={styles.heading1}>{children}</h4>,
    h2: ({ children }) => <h5 className={styles.heading2}>{children}</h5>,
    h3: ({ children }) => <h6 className={styles.heading3}>{children}</h6>,
    h4: ({ children }) => <h6 className={styles.heading4}>{children}</h6>,
    // Lists
    ul: ({ children }) => <ul className={styles.list}>{children}</ul>,
    ol: ({ children }) => <ol className={styles.orderedList}>{children}</ol>,
    li: ({ children }) => <li className={styles.listItem}>{children}</li>,
    // Blockquotes
    blockquote: ({ children }) => (
      <blockquote className={styles.blockquote}>{children}</blockquote>
    ),
    // Paragraphs
    p: ({ children }) => <p className={styles.paragraph}>{children}</p>,
    // Tables
    table: ({ children }) => (
      <div className={styles.tableWrapper}>
        <table className={styles.table}>{children}</table>
      </div>
    ),
    th: ({ children }) => <th className={styles.tableHeader}>{children}</th>,
    td: ({ children }) => <td className={styles.tableCell}>{children}</td>,
    // Horizontal rule
    hr: () => <hr className={styles.hr} />,
    // Strong and emphasis
    strong: ({ children }) => <strong className={styles.strong}>{children}</strong>,
    em: ({ children }) => <em className={styles.emphasis}>{children}</em>,
    // Pre blocks (handled by code)
    pre: ({ children }) => <>{children}</>,
  };

  const containerClasses = [
    styles.markdownContainer,
    isUser ? styles.userMessage : styles.assistantMessage,
    needsExpansion && !isExpanded ? styles.collapsed : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div className={containerClasses}>
      <div
        ref={contentRef}
        className={styles.markdownContent}
        style={{
          maxHeight: needsExpansion && !isExpanded ? maxCollapsedHeight : undefined,
        }}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {content}
        </ReactMarkdown>
      </div>

      {needsExpansion && (
        <button
          className={styles.expandButton}
          onClick={() => setIsExpanded(!isExpanded)}
          type="button"
        >
          {isExpanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

export const MarkdownRenderer = memo(MarkdownRendererInner);
