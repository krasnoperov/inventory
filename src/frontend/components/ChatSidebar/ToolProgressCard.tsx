/**
 * ToolProgressCard - Expandable card showing tool execution progress
 *
 * Displays tool execution status during agentic loop:
 * - Collapsed: Icon + tool name + status
 * - Expanded: Shows result/error details
 */

import { useState } from 'react';
import type { ToolProgress } from '../../stores/chatStore';
import styles from './ToolProgressCard.module.css';
import ReactMarkdown from 'react-markdown';

interface ToolProgressCardProps {
  progress: ToolProgress;
}

/** Get human-readable tool name */
function getToolDisplayName(toolName: string): string {
  const displayNames: Record<string, string> = {
    describe: 'Analyzing image',
    compare: 'Comparing images',
    search: 'Searching assets',
    add_to_tray: 'Adding to tray',
    remove_from_tray: 'Removing from tray',
    clear_tray: 'Clearing tray',
    set_prompt: 'Setting prompt',
    generate: 'Generating asset',
    derive: 'Deriving from reference',
    refine: 'Refining variant',
    update_plan: 'Updating plan',
  };
  return displayNames[toolName] || toolName;
}

/** Get context from tool params */
function getToolContext(toolName: string, params: Record<string, unknown>): string | null {
  switch (toolName) {
    case 'describe':
    case 'add_to_tray':
      return params.assetName as string | null;
    case 'compare':
      return `${(params.variantIds as string[] | undefined)?.length || 0} variants`;
    case 'search':
      return params.query as string | null;
    case 'set_prompt': {
      const prompt = params.prompt as string | undefined;
      return prompt ? `"${prompt.slice(0, 30)}${prompt.length > 30 ? '...' : ''}"` : null;
    }
    default:
      return null;
  }
}

export function ToolProgressCard({ progress }: ToolProgressCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const displayName = getToolDisplayName(progress.toolName);
  const context = getToolContext(progress.toolName, progress.toolParams);
  const hasContent = progress.result || progress.error;

  // Status icons
  const statusIcon = progress.status === 'executing'
    ? <span className={styles.spinner} />
    : progress.status === 'complete'
      ? <span className={styles.checkIcon}>✓</span>
      : <span className={styles.errorIcon}>✕</span>;

  return (
    <div className={`${styles.card} ${styles[progress.status]}`}>
      <button
        className={styles.header}
        onClick={() => hasContent && setIsExpanded(!isExpanded)}
        disabled={!hasContent}
        type="button"
      >
        <span className={styles.statusIcon}>{statusIcon}</span>
        <span className={styles.toolName}>
          {displayName}
          {context && <span className={styles.context}> ({context})</span>}
        </span>
        {hasContent && (
          <span className={`${styles.chevron} ${isExpanded ? styles.expanded : ''}`}>
            ▼
          </span>
        )}
      </button>

      {isExpanded && hasContent && (
        <div className={styles.content}>
          {progress.error ? (
            <div className={styles.error}>{progress.error}</div>
          ) : (
            <div className={styles.result}>
              <ReactMarkdown>{progress.result || ''}</ReactMarkdown>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface ToolProgressListProps {
  progress: ToolProgress[];
  requestId: string | null;
}

export function ToolProgressList({ progress, requestId }: ToolProgressListProps) {
  // Filter progress items for the active request
  const activeProgress = requestId
    ? progress.filter(p => p.requestId === requestId)
    : progress;

  if (activeProgress.length === 0) {
    return null;
  }

  return (
    <div className={styles.list}>
      {activeProgress.map((p, index) => (
        <ToolProgressCard key={`${p.requestId}-${p.toolName}-${index}`} progress={p} />
      ))}
    </div>
  );
}
