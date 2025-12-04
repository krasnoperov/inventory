/**
 * Controller Infrastructure Types
 *
 * Shared types and base class for all domain controllers.
 * Controllers encapsulate handlers and business logic for specific domains.
 */

import type { Env } from '../../../../core/types';
import type { SpaceRepository, SqlStorage } from '../repository/SpaceRepository';
import type { ServerMessage, WebSocketMeta } from '../types';
import type { ErrorCode } from '../../../../shared/websocket-types';

// ============================================================================
// Function Types
// ============================================================================

/** Broadcast a message to all connected WebSockets */
export type BroadcastFn = (message: ServerMessage, excludeWs?: WebSocket) => void;

/** Send a message to a specific WebSocket */
export type SendFn = (ws: WebSocket, message: ServerMessage) => void;

/** Send an error message to a specific WebSocket */
export type SendErrorFn = (ws: WebSocket, code: ErrorCode, message: string) => void;

// ============================================================================
// Controller Context (Dependency Container)
// ============================================================================

/**
 * Context passed to all controllers containing shared dependencies.
 * This is the dependency injection mechanism for controllers.
 */
export interface ControllerContext {
  /** The space ID this DO instance represents */
  spaceId: string;

  /** Data access layer */
  repo: SpaceRepository;

  /** Cloudflare environment bindings */
  env: Env;

  /** Raw SQL storage for queries not in repository */
  sql: SqlStorage;

  /** Broadcast message to all connected clients */
  broadcast: BroadcastFn;

  /** Send message to a specific client */
  send: SendFn;

  /** Send error to a specific client */
  sendError: SendErrorFn;
}

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Permission denied error - thrown when user lacks required role
 */
export class PermissionError extends Error {
  override readonly name = 'PermissionError' as const;

  constructor(message: string = 'Permission denied') {
    super(message);
  }
}

/**
 * Not found error - thrown when requested resource doesn't exist
 */
export class NotFoundError extends Error {
  override readonly name = 'NotFoundError' as const;

  constructor(message: string = 'Resource not found') {
    super(message);
  }
}

/**
 * Validation error - thrown for invalid input or operation
 */
export class ValidationError extends Error {
  override readonly name = 'ValidationError' as const;

  constructor(message: string = 'Validation failed') {
    super(message);
  }
}

// ============================================================================
// Base Controller
// ============================================================================

/**
 * Base controller class with common functionality.
 * All domain controllers extend this class.
 */
export abstract class BaseController {
  protected readonly repo: SpaceRepository;
  protected readonly broadcast: BroadcastFn;
  protected readonly send: SendFn;
  protected readonly sendError: SendErrorFn;
  protected readonly spaceId: string;
  protected readonly env: Env;
  protected readonly sql: SqlStorage;

  constructor(ctx: ControllerContext) {
    this.repo = ctx.repo;
    this.broadcast = ctx.broadcast;
    this.send = ctx.send;
    this.sendError = ctx.sendError;
    this.spaceId = ctx.spaceId;
    this.env = ctx.env;
    this.sql = ctx.sql;
  }

  /**
   * Require the user to be an editor or owner (not viewer).
   * @throws PermissionError if user is a viewer
   */
  protected requireEditor(meta: WebSocketMeta): void {
    if (meta.role === 'viewer') {
      throw new PermissionError('Viewers cannot perform this action');
    }
  }

  /**
   * Require the user to be the owner.
   * @throws PermissionError if user is not the owner
   */
  protected requireOwner(meta: WebSocketMeta): void {
    if (meta.role !== 'owner') {
      throw new PermissionError('Only owners can perform this action');
    }
  }
}
