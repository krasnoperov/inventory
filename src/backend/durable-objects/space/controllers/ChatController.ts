/**
 * Chat Controller
 *
 * Handles user chat messages within a space.
 * Manages chat history storage and retrieval.
 */

import type { ChatMessage, WebSocketMeta } from '../types';
import { BaseController, type ControllerContext } from './types';

export class ChatController extends BaseController {
  constructor(ctx: ControllerContext) {
    super(ctx);
  }

  /**
   * Handle chat:send WebSocket message
   * Creates a chat message and broadcasts to all clients
   */
  async handleSend(ws: WebSocket, meta: WebSocketMeta, content: string): Promise<void> {
    const message = await this.repo.createChatMessage({
      id: crypto.randomUUID(),
      senderType: 'user',
      senderId: meta.userId,
      content,
    });

    this.broadcast({ type: 'chat:message', message });
  }

  /**
   * Handle POST /internal/chat HTTP request
   * Stores a chat message (used by workflows for bot responses)
   */
  async httpStoreMessage(data: {
    senderType: 'user' | 'bot';
    senderId: string;
    content: string;
    metadata?: string;
  }): Promise<ChatMessage> {
    const message = await this.repo.createChatMessage({
      id: crypto.randomUUID(),
      senderType: data.senderType,
      senderId: data.senderId,
      content: data.content,
      metadata: data.metadata,
    });

    // Broadcast to all connected clients
    this.broadcast({ type: 'chat:message', message });

    return message;
  }

  /**
   * Handle GET /internal/chat/history HTTP request
   * Returns chat history in chronological order
   */
  async httpGetHistory(): Promise<ChatMessage[]> {
    const messages = await this.repo.getChatHistory(100);
    return messages.reverse(); // Return in chronological order
  }

  /**
   * Handle DELETE /internal/chat/history HTTP request
   * Clears all chat history
   */
  async httpClearHistory(): Promise<void> {
    await this.repo.clearChatHistory();
  }
}
