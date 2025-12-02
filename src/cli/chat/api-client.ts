/**
 * API Client for Chat Test CLI
 *
 * Handles HTTP calls to REST APIs.
 * Note: Generation operations (generate_asset, refine_asset, combine_assets) are
 * now handled via WebSocket in execute.ts and advance.ts.
 */

import process from 'node:process';
import type {
  BotResponse,
  ChatMessage,
  ForgeContext,
  ViewingContext,
} from '../../api/types';
import { loadStoredConfig, resolveBaseUrl } from '../lib/config';

export interface ChatRequest {
  message: string;
  mode: 'advisor' | 'actor';
  history?: ChatMessage[];
  forgeContext?: ForgeContext;
  viewingContext?: ViewingContext;
}

export interface ChatResponse {
  success: boolean;
  response: BotResponse;
}

export class ApiClient {
  private baseUrl: string;
  private accessToken: string;
  private env: string;

  constructor(baseUrl: string, accessToken: string, env: string) {
    this.baseUrl = baseUrl;
    this.accessToken = accessToken;
    this.env = env;
  }

  /**
   * Create an ApiClient for a given environment
   */
  static async create(env: string): Promise<ApiClient> {
    const config = await loadStoredConfig(env);
    if (!config) {
      throw new Error(
        `Not logged in to ${env} environment.\n` +
        `Run: npm run cli login --env ${env}`
      );
    }

    // Check token expiry
    if (config.token.expiresAt < Date.now()) {
      throw new Error(
        `Token expired for ${env} environment.\n` +
        `Run: npm run cli login --env ${env}`
      );
    }

    const baseUrl = resolveBaseUrl(env);

    // Disable SSL verification for local dev
    if (env === 'local') {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    }

    return new ApiClient(baseUrl, config.token.accessToken, env);
  }

  /**
   * Make an authenticated HTTP request
   */
  private async fetch<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error(
          `Authentication failed. Token may have expired.\n` +
          `Run: npm run cli login --env ${this.env}`
        );
      }

      // Try to get error details
      let errorMessage = `API error (${response.status})`;
      try {
        const errorData = await response.json() as { error?: string; message?: string };
        if (errorData.error) {
          errorMessage = errorData.error;
        } else if (errorData.message) {
          errorMessage = errorData.message;
        }
      } catch {
        errorMessage = await response.text() || errorMessage;
      }

      throw new Error(errorMessage);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Send a chat message
   */
  async sendChat(spaceId: string, request: ChatRequest): Promise<ChatResponse> {
    return this.fetch<ChatResponse>(`/api/spaces/${spaceId}/chat`, {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  /**
   * Get space info (name, etc.)
   */
  async getSpace(spaceId: string): Promise<{ name: string }> {
    const response = await this.fetch<{ space: { name: string } }>(`/api/spaces/${spaceId}`);
    return { name: response.space.name };
  }

  /**
   * Get space assets (for resolving asset IDs to variant IDs)
   */
  async getSpaceAssets(spaceId: string): Promise<{
    assets: Array<{ id: string; name: string; active_variant_id: string | null }>;
  }> {
    return this.fetch(`/api/spaces/${spaceId}/assets`);
  }
}
