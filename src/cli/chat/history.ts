/**
 * History Command - View chat history from server
 *
 * Usage: npm run cli chat history --space <id>
 */

import process from 'node:process';
import type { ParsedArgs } from '../lib/types';
import { resolveBaseUrl, loadStoredConfig } from '../lib/config';

interface ChatMessage {
  id: string;
  sender_type: 'user' | 'bot';
  sender_id: string;
  content: string;
  metadata: string | null;
  created_at: number;
}

export async function handleHistory(parsed: ParsedArgs): Promise<void> {
  const spaceId = parsed.options.space;
  const limit = parseInt(parsed.options.limit || '50', 10);
  const isLocal = parsed.options.local === 'true';
  const env = isLocal ? 'local' : (parsed.options.env || 'stage');

  if (!spaceId) {
    console.error('Error: --space <id> is required');
    process.exitCode = 1;
    return;
  }

  try {
    const config = await loadStoredConfig(env);
    if (!config) {
      console.error(`Not logged in to ${env} environment.`);
      console.error(`Run: npm run cli login --env ${env}`);
      process.exitCode = 1;
      return;
    }

    const baseUrl = resolveBaseUrl(env);
    const response = await fetch(`${baseUrl}/api/spaces/${spaceId}/chat/history?limit=${limit}`, {
      headers: {
        'Authorization': `Bearer ${config.token.accessToken}`,
      },
    });

    if (!response.ok) {
      const errorData = await response.json() as { error?: string };
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    const data = await response.json() as { success: boolean; messages: ChatMessage[] };

    if (!data.success || !data.messages || data.messages.length === 0) {
      console.log('\nNo chat history found.');
      console.log(`\nStart a conversation: npm run cli chat send "<message>" --space ${spaceId}`);
      return;
    }

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`Chat History (${data.messages.length} messages)`);
    console.log(`${'═'.repeat(60)}`);

    for (const msg of data.messages) {
      const timestamp = new Date(msg.created_at).toLocaleString();
      const role = msg.sender_type === 'user' ? '👤 You' : '🤖 Assistant';

      console.log(`\n${role} [${timestamp}]`);
      console.log(`${'─'.repeat(40)}`);
      console.log(msg.content);

      // Parse and display metadata if present
      if (msg.metadata) {
        try {
          const meta = JSON.parse(msg.metadata) as Record<string, unknown>;
          if (meta.type) {
            console.log(`  [type: ${meta.type}]`);
          }
          if (meta.planId) {
            console.log(`  [plan: ${meta.planId}]`);
          }
          if (meta.approvalIds && Array.isArray(meta.approvalIds)) {
            console.log(`  [approvals: ${(meta.approvalIds as string[]).length}]`);
          }
        } catch {
          // Ignore parse errors
        }
      }
    }

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`\nTo continue: npm run cli chat send "<message>" --space ${spaceId}`);

  } catch (error) {
    console.error('\nError:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
