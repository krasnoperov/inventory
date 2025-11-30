/**
 * State Management for Chat CLI
 *
 * Load and save conversation state to JSON files.
 * Also manages human-readable markdown logs.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { ConversationState } from './types';
import { getLogPath, logExists, initLog, appendLogEntry, type LogEntry } from './logger';

/**
 * Load state from a JSON file
 * @returns null if file doesn't exist
 */
export async function loadState(statePath: string): Promise<ConversationState | null> {
  try {
    const raw = await readFile(statePath, 'utf8');
    return JSON.parse(raw) as ConversationState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw new Error(`Failed to load state from ${statePath}: ${(error as Error).message}`);
  }
}

/**
 * Save state to a JSON file
 * Creates parent directories if needed
 */
export async function saveState(statePath: string, state: ConversationState): Promise<void> {
  // Update timestamp
  state.meta.updatedAt = new Date().toISOString();

  // Ensure directory exists
  const dir = path.dirname(statePath);
  await mkdir(dir, { recursive: true });

  // Write formatted JSON
  await writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
}

/**
 * Save state and optionally append to markdown log
 * Creates log file with header if it doesn't exist
 */
export async function saveStateWithLog(
  statePath: string,
  state: ConversationState,
  logEntry?: LogEntry
): Promise<void> {
  // Save JSON state
  await saveState(statePath, state);

  // Handle log if entry provided
  if (logEntry) {
    const logPath = getLogPath(statePath);

    // Initialize log if it doesn't exist
    if (!(await logExists(logPath))) {
      await initLog(logPath, state);
    }

    await appendLogEntry(logPath, logEntry);
  }
}
