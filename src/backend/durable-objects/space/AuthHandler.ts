/**
 * AuthHandler - WebSocket Authentication Handler
 *
 * Encapsulates authentication logic for WebSocket upgrades:
 * - Token extraction from cookies
 * - JWT verification
 * - Space membership validation
 */

import { AuthService } from '../../features/auth/auth-service';
import { getMemberRole } from '../../../dao/member-queries';
import type { Env } from '../../../core/types';
import type { WebSocketMeta } from './types';

/**
 * Result of authentication attempt
 */
export type AuthResult =
  | { success: true; meta: WebSocketMeta }
  | { success: false; status: number; message: string };

/**
 * Handles WebSocket authentication for SpaceDO
 */
export class AuthHandler {
  constructor(
    private readonly env: Env,
    private readonly spaceId: string
  ) {}

  /**
   * Authenticate a WebSocket upgrade request
   *
   * @param request - The incoming request with cookies or Authorization header
   * @returns AuthResult with either WebSocketMeta or error details
   */
  async authenticate(request: Request): Promise<AuthResult> {
    // Try Authorization header first (for CLI), then fall back to cookies (for browser)
    const authHeader = request.headers.get('Authorization');
    const cookieHeader = request.headers.get('Cookie');
    const token = this.extractBearerToken(authHeader) || this.extractAuthToken(cookieHeader);

    if (!token) {
      return { success: false, status: 401, message: 'Missing authentication' };
    }

    // Verify JWT
    const authService = new AuthService(this.env);
    const payload = await authService.verifyJWT(token);

    if (!payload) {
      return { success: false, status: 401, message: 'Invalid token' };
    }

    // Check membership in D1
    const role = await getMemberRole(this.env.DB, this.spaceId, payload.userId);

    if (!role) {
      console.log('WebSocket auth failed: not a member', {
        spaceId: this.spaceId,
        userId: payload.userId,
      });
      return { success: false, status: 403, message: 'Not a member' };
    }

    // Build WebSocket metadata
    const meta: WebSocketMeta = {
      userId: String(payload.userId),
      role,
    };

    return { success: true, meta };
  }

  /**
   * Extract Bearer token from Authorization header
   */
  private extractBearerToken(authHeader: string | null): string | null {
    if (!authHeader) return null;
    if (authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }
    return null;
  }

  /**
   * Extract auth token from cookie header
   */
  private extractAuthToken(cookieHeader: string | null): string | null {
    if (!cookieHeader) return null;

    const cookies = cookieHeader.split(';').map((c) => c.trim());
    for (const cookie of cookies) {
      if (cookie.startsWith('auth_token=')) {
        return cookie.substring('auth_token='.length);
      }
    }

    return null;
  }
}
