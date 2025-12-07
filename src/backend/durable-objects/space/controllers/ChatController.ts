/**
 * Chat Controller
 *
 * Handles persistent chat sessions in SpaceDO.
 * Each user has one active chat session per space.
 * Messages include ForgeTray context for visual-aware assistance.
 */

import { ClaudeService } from '../../../services/claudeService';
import { hasApiKey, hasStorage } from '../vision/VisionService';
import { BaseController, type ControllerContext } from './types';
import type { ChatMessage } from '../types';
import { loggers } from '../../../../shared/logger';
import { nanoid } from 'nanoid';

const log = loggers.chatController;

/** Forge context sent with each user message */
interface ForgeContext {
  prompt: string;
  slotVariantIds: string[];
}

/** User message metadata stored in DB */
interface UserMessageMetadata {
  forgeContext?: ForgeContext;
}

/** Bot message metadata stored in DB */
interface BotMessageMetadata {
  suggestedPrompt?: string;
  descriptions?: Array<{
    variantId: string;
    assetName: string;
    description: string;
    cached: boolean;
  }>;
  usage?: { inputTokens: number; outputTokens: number };
}

/** Chat send message from client */
interface ChatSendMessage {
  type: 'chat:send';
  content: string;
  forgeContext?: ForgeContext;
}

/** Chat history request from client */
interface ChatHistoryMessage {
  type: 'chat:history';
}

/** Chat clear request from client */
interface ChatClearMessage {
  type: 'chat:clear';
}

const HISTORY_LIMIT = 50;

export class ChatController extends BaseController {
  constructor(ctx: ControllerContext) {
    super(ctx);
  }

  /**
   * Handle chat:history - load messages for user's active session
   */
  async handleChatHistory(ws: WebSocket, userId: string): Promise<void> {
    const timer = log.startTimer('Load chat history', { spaceId: this.spaceId, userId });

    try {
      // Get user's active session
      const userSession = await this.repo.getUserSession(userId);
      const sessionId = userSession?.active_chat_session_id;

      let messages: ChatMessage[] = [];
      if (sessionId) {
        messages = await this.repo.getChatHistoryBySession(sessionId, HISTORY_LIMIT);
      }

      timer(true, { messageCount: messages.length, sessionId });

      this.send(ws, {
        type: 'chat:history',
        sessionId: sessionId || null,
        messages: messages.map(this.formatMessageForClient),
      });
    } catch (error) {
      timer(false, { error: error instanceof Error ? error.message : String(error) });
      this.sendError(ws, 'INTERNAL_ERROR', 'Failed to load chat history');
    }
  }

  /**
   * Handle chat:send - store user message, process with Claude, store response
   */
  async handleChatSend(ws: WebSocket, userId: string, msg: ChatSendMessage): Promise<void> {
    // Validate content
    const content = msg.content?.trim();
    if (!content) {
      this.sendError(ws, 'VALIDATION_ERROR', 'Message cannot be empty');
      return;
    }

    // Check Claude API key
    if (!hasApiKey(this.env.ANTHROPIC_API_KEY)) {
      this.sendError(ws, 'INTERNAL_ERROR', 'Claude API not configured');
      return;
    }

    const requestId = nanoid(8);
    const timer = log.startTimer('Chat send', {
      requestId,
      spaceId: this.spaceId,
      userId,
      slotCount: msg.forgeContext?.slotVariantIds?.length ?? 0,
    });

    try {
      // Get or create active chat session
      let userSession = await this.repo.getUserSession(userId);
      let sessionId = userSession?.active_chat_session_id;

      if (!sessionId) {
        // Create new session
        const title = content.substring(0, 50) + (content.length > 50 ? '...' : '');
        const newSession = await this.repo.createChatSession({
          id: nanoid(),
          title,
          createdBy: userId,
        });
        sessionId = newSession.id;
        await this.repo.updateUserActiveChatSession(userId, sessionId);
      }

      // Store user message
      const userMetadata: UserMessageMetadata = {};
      if (msg.forgeContext) {
        userMetadata.forgeContext = msg.forgeContext;
      }

      const userMessage = await this.repo.createChatMessage({
        id: nanoid(),
        sessionId,
        senderType: 'user',
        senderId: userId,
        content,
        metadata: Object.keys(userMetadata).length > 0 ? JSON.stringify(userMetadata) : null,
      });

      // Send acknowledgment that user message was stored
      this.send(ws, {
        type: 'chat:message',
        message: this.formatMessageForClient(userMessage),
      });

      // Load conversation history from DB (excluding the message we just added)
      const history = await this.repo.getChatHistoryBySession(sessionId, HISTORY_LIMIT);
      const conversationHistory = history
        .filter((m) => m.id !== userMessage.id)
        .map((m) => ({
          role: m.sender_type === 'user' ? 'user' as const : 'assistant' as const,
          content: m.content,
        }));

      // Check if this is first message (for image description)
      const isFirstMessage = conversationHistory.length === 0;
      const slotVariantIds = msg.forgeContext?.slotVariantIds ?? [];
      const hasImages = slotVariantIds.length > 0 && hasStorage(this.env.IMAGES);

      // Collect descriptions and images for context
      const variantDescriptions: Array<{ variantId: string; assetName: string; description: string }> = [];
      const collectedDescriptions: Array<{ variantId: string; assetName: string; description: string; cached: boolean }> = [];
      let images: Array<{ base64: string; mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; assetName: string }> | undefined;

      const claudeService = new ClaudeService(this.env.ANTHROPIC_API_KEY!);

      // For first message with images, generate descriptions on-demand with progress
      if (isFirstMessage && hasImages) {
        const total = slotVariantIds.length;

        for (let i = 0; i < slotVariantIds.length; i++) {
          const variantId = slotVariantIds[i];
          const index = i + 1;

          // Get variant info and check for cached description
          const result = await this.sql.exec(
            `SELECT v.description, v.image_key, a.name as asset_name
             FROM variants v
             JOIN assets a ON v.asset_id = a.id
             WHERE v.id = ?`,
            variantId
          );
          const row = result.toArray()[0] as { description: string | null; image_key: string | null; asset_name: string } | undefined;

          if (!row) continue;

          const assetName = row.asset_name;

          if (row.description) {
            // Use cached description
            this.send(ws, {
              type: 'chat:progress',
              requestId,
              phase: 'describing',
              variantId,
              assetName,
              status: 'cached',
              description: row.description,
              index,
              total,
            });
            variantDescriptions.push({ variantId, assetName, description: row.description });
            collectedDescriptions.push({ variantId, assetName, description: row.description, cached: true });
          } else if (row.image_key) {
            // Need to generate description
            this.send(ws, {
              type: 'chat:progress',
              requestId,
              phase: 'describing',
              variantId,
              assetName,
              status: 'started',
              index,
              total,
            });

            // Fetch image and describe
            const imageObj = await this.env.IMAGES!.get(row.image_key);
            if (imageObj) {
              const buffer = await imageObj.arrayBuffer();
              const bytes = new Uint8Array(buffer);
              let binary = '';
              const chunkSize = 8192;
              for (let j = 0; j < bytes.length; j += chunkSize) {
                const chunk = bytes.subarray(j, Math.min(j + chunkSize, bytes.length));
                binary += String.fromCharCode.apply(null, Array.from(chunk));
              }
              const base64 = btoa(binary);

              // Determine media type
              let mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' = 'image/jpeg';
              if (row.image_key.endsWith('.png')) mediaType = 'image/png';
              else if (row.image_key.endsWith('.gif')) mediaType = 'image/gif';
              else if (row.image_key.endsWith('.webp')) mediaType = 'image/webp';

              // Generate description
              const descResult = await claudeService.describeImage(base64, mediaType, assetName, 'prompt');
              const description = descResult.description;

              // Cache the description
              await this.sql.exec(
                'UPDATE variants SET description = ?, updated_at = ? WHERE id = ?',
                description,
                Date.now(),
                variantId
              );

              // Send completion progress
              this.send(ws, {
                type: 'chat:progress',
                requestId,
                phase: 'describing',
                variantId,
                assetName,
                status: 'completed',
                description,
                index,
                total,
              });

              variantDescriptions.push({ variantId, assetName, description });
              collectedDescriptions.push({ variantId, assetName, description, cached: false });
            }
          }
        }

        // Also fetch images for direct visual analysis
        images = await this.getVariantImages(slotVariantIds);
      } else if (slotVariantIds.length > 0) {
        // Follow-up message: just get cached descriptions (no progress needed)
        const cached = await this.getVariantDescriptions(slotVariantIds);
        variantDescriptions.push(...cached);
      }

      // Call Claude with all context
      const currentPrompt = msg.forgeContext?.prompt ?? '';
      const result = await claudeService.forgeChat(
        content,
        currentPrompt,
        variantDescriptions,
        conversationHistory,
        images
      );

      // Store bot response
      const botMetadata: BotMessageMetadata = {
        usage: result.usage,
      };
      if (result.suggestedPrompt) {
        botMetadata.suggestedPrompt = result.suggestedPrompt;
      }
      if (collectedDescriptions.length > 0) {
        botMetadata.descriptions = collectedDescriptions;
      }

      const botMessage = await this.repo.createChatMessage({
        id: nanoid(),
        sessionId,
        senderType: 'bot',
        senderId: 'claude',
        content: result.message,
        metadata: JSON.stringify(botMetadata),
      });

      timer(true, {
        sessionId,
        responseLength: result.message.length,
        hasSuggestedPrompt: !!result.suggestedPrompt,
        outputTokens: result.usage.outputTokens,
        descriptionsUsed: variantDescriptions.length,
        imagesAttached: images?.length ?? 0,
      });

      // Send bot response to client
      this.send(ws, {
        type: 'chat:message',
        message: this.formatMessageForClient(botMessage),
      });
    } catch (error) {
      timer(false, { error: error instanceof Error ? error.message : String(error) });
      log.error('Chat send failed', { userId, spaceId: this.spaceId }, error instanceof Error ? error : undefined);
      this.sendError(ws, 'INTERNAL_ERROR', 'Failed to process message');
    }
  }

  /**
   * Handle chat:clear - create new session and set as active
   */
  async handleChatClear(ws: WebSocket, userId: string): Promise<void> {
    const timer = log.startTimer('Clear chat', { spaceId: this.spaceId, userId });

    try {
      // Create new empty session
      const newSession = await this.repo.createChatSession({
        id: nanoid(),
        title: 'New Chat',
        createdBy: userId,
      });

      // Set as active
      await this.repo.updateUserActiveChatSession(userId, newSession.id);

      timer(true, { newSessionId: newSession.id });

      // Send empty history with new session
      this.send(ws, {
        type: 'chat:history',
        sessionId: newSession.id,
        messages: [],
      });
    } catch (error) {
      timer(false, { error: error instanceof Error ? error.message : String(error) });
      this.sendError(ws, 'INTERNAL_ERROR', 'Failed to clear chat');
    }
  }

  /**
   * Format a DB message for client consumption
   */
  private formatMessageForClient(msg: ChatMessage): {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    createdAt: number;
    suggestedPrompt?: string;
    descriptions?: Array<{ variantId: string; assetName: string; description: string; cached: boolean }>;
  } {
    const result: {
      id: string;
      role: 'user' | 'assistant';
      content: string;
      createdAt: number;
      suggestedPrompt?: string;
      descriptions?: Array<{ variantId: string; assetName: string; description: string; cached: boolean }>;
    } = {
      id: msg.id,
      role: msg.sender_type === 'user' ? 'user' : 'assistant',
      content: msg.content,
      createdAt: msg.created_at,
    };

    // Parse metadata for bot messages
    if (msg.sender_type === 'bot' && msg.metadata) {
      try {
        const metadata = JSON.parse(msg.metadata) as BotMessageMetadata;
        if (metadata.suggestedPrompt) {
          result.suggestedPrompt = metadata.suggestedPrompt;
        }
        if (metadata.descriptions) {
          result.descriptions = metadata.descriptions;
        }
      } catch {
        // Ignore parse errors
      }
    }

    return result;
  }

  /**
   * Get cached descriptions for multiple variants
   */
  private async getVariantDescriptions(
    variantIds: string[]
  ): Promise<Array<{ variantId: string; assetName: string; description: string }>> {
    const descriptions: Array<{ variantId: string; assetName: string; description: string }> = [];

    for (const variantId of variantIds) {
      const result = await this.sql.exec(
        `SELECT v.description, a.name as asset_name
         FROM variants v
         JOIN assets a ON v.asset_id = a.id
         WHERE v.id = ?`,
        variantId
      );
      const row = result.toArray()[0] as { description: string | null; asset_name: string } | undefined;

      if (row?.description) {
        descriptions.push({
          variantId,
          assetName: row.asset_name,
          description: row.description,
        });
      }
    }

    return descriptions;
  }

  /**
   * Get actual images for multiple variants (for vision API)
   */
  private async getVariantImages(
    variantIds: string[]
  ): Promise<Array<{ base64: string; mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; assetName: string }>> {
    const images: Array<{ base64: string; mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; assetName: string }> = [];

    for (const variantId of variantIds) {
      const result = await this.sql.exec(
        `SELECT v.image_key, a.name as asset_name
         FROM variants v
         JOIN assets a ON v.asset_id = a.id
         WHERE v.id = ? AND v.image_key IS NOT NULL`,
        variantId
      );
      const row = result.toArray()[0] as { image_key: string; asset_name: string } | undefined;

      if (row?.image_key) {
        const obj = await this.env.IMAGES!.get(row.image_key);
        if (obj) {
          const buffer = await obj.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          let binary = '';
          const chunkSize = 8192;
          for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
            binary += String.fromCharCode.apply(null, Array.from(chunk));
          }
          const base64 = btoa(binary);

          let mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' = 'image/jpeg';
          if (row.image_key.endsWith('.png')) {
            mediaType = 'image/png';
          } else if (row.image_key.endsWith('.gif')) {
            mediaType = 'image/gif';
          } else if (row.image_key.endsWith('.webp')) {
            mediaType = 'image/webp';
          }

          images.push({
            base64,
            mediaType,
            assetName: row.asset_name,
          });
        }
      }
    }

    return images;
  }
}
