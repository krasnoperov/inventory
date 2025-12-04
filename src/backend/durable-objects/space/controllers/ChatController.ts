/**
 * Chat Controller
 *
 * Handles user chat messages within a space.
 * Manages chat sessions and message history.
 */

import type { ChatMessage, ChatSession, WebSocketMeta } from '../types';
import { BaseController, type ControllerContext } from './types';

export class ChatController extends BaseController {
  constructor(ctx: ControllerContext) {
    super(ctx);
  }

  /**
   * Get or create an active chat session for the user.
   * If user has no active session, create one.
   */
  private async getOrCreateActiveSession(userId: string): Promise<ChatSession> {
    // Check user's active session
    const userSession = await this.repo.getUserSession(userId);
    if (userSession?.active_chat_session_id) {
      const session = await this.repo.getChatSessionById(userSession.active_chat_session_id);
      if (session) return session;
    }

    // No active session - create one
    const newSession = await this.repo.createChatSession({
      id: crypto.randomUUID(),
      createdBy: userId,
    });

    // Update user's active session
    await this.repo.updateUserActiveChatSession(userId, newSession.id);

    return newSession;
  }

  /**
   * Handle chat:send WebSocket message
   * Creates a chat message in the user's active session and broadcasts to all clients
   */
  async handleSend(ws: WebSocket, meta: WebSocketMeta, content: string): Promise<void> {
    // Ensure user has an active session
    const session = await this.getOrCreateActiveSession(meta.userId);

    const message = await this.repo.createChatMessage({
      id: crypto.randomUUID(),
      sessionId: session.id,
      senderType: 'user',
      senderId: meta.userId,
      content,
    });

    this.broadcast({ type: 'chat:message', message });
  }

  /**
   * Handle chat:history WebSocket message
   * Returns chat history for the user's active session
   */
  async handleHistory(ws: WebSocket, meta: WebSocketMeta, since?: number): Promise<void> {
    // Get user's active session
    const userSession = await this.repo.getUserSession(meta.userId);
    const sessionId = userSession?.active_chat_session_id;

    let messages: ChatMessage[] = [];
    if (sessionId) {
      messages = await this.repo.getChatHistoryBySession(sessionId, 100);
    }

    // Filter by timestamp if provided
    const filtered = since
      ? messages.filter((m) => m.created_at > since)
      : messages;

    // Return in chronological order
    this.send(ws, { type: 'chat:history', messages: filtered.reverse(), sessionId: sessionId ?? null });
  }

  /**
   * Handle chat:new_session WebSocket message
   * Creates a new chat session and sets it as active
   */
  async handleNewSession(ws: WebSocket, meta: WebSocketMeta): Promise<void> {
    // Create new session
    const session = await this.repo.createChatSession({
      id: crypto.randomUUID(),
      createdBy: meta.userId,
    });

    // Update user's active session
    await this.repo.updateUserActiveChatSession(meta.userId, session.id);

    // Notify client
    this.send(ws, { type: 'chat:session_created', session });

    // Also send empty history for the new session
    this.send(ws, { type: 'chat:history', messages: [], sessionId: session.id });
  }

  /**
   * Handle POST /internal/chat HTTP request
   * Stores a chat message (used by workflows for bot responses)
   */
  async httpStoreMessage(data: {
    senderType: 'user' | 'bot';
    senderId: string;
    content: string;
    metadata?: string | null;
  }): Promise<ChatMessage> {
    // Get sender's active session (for bot messages, use the user who triggered the workflow)
    const session = await this.getOrCreateActiveSession(data.senderId);

    const message = await this.repo.createChatMessage({
      id: crypto.randomUUID(),
      sessionId: session.id,
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
   * Handle DELETE /internal/chat/history HTTP request
   * Clears all chat history (all sessions)
   */
  async httpClearHistory(): Promise<void> {
    await this.repo.clearChatHistory();
  }
}
