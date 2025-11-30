/**
 * API Client for Chat Test CLI
 *
 * Handles all HTTP calls to the chat and asset APIs.
 */

import process from 'node:process';
import type {
  BotResponse,
  ChatMessage,
  ForgeContext,
  ViewingContext,
} from '../../api/types';
import { loadStoredConfig, resolveBaseUrl } from '../lib/config';
import type { ActionResult, JobResult, PendingAction } from './types';

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

  /**
   * Get job status
   */
  async getJob(jobId: string): Promise<{
    job: {
      id: string;
      status: string;
      result_variant_id: string | null;
      error: string | null;
      input: string;
    };
  }> {
    return this.fetch(`/api/jobs/${jobId}`);
  }

  /**
   * Create a new asset (generate, fork, compose)
   */
  async createAsset(
    spaceId: string,
    params: {
      name: string;
      type: string;
      prompt?: string;
      referenceAssetIds?: string[];  // Preferred: backend resolves to default variants
      referenceVariantIds?: string[]; // Fallback: explicit variant IDs
      aspectRatio?: string;
    }
  ): Promise<{
    success: boolean;
    mode: string;
    jobId?: string;
    assetId: string;
    variantId?: string;
  }> {
    return this.fetch(`/api/spaces/${spaceId}/assets`, {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  /**
   * Create a new variant (refine existing asset)
   */
  async createVariant(
    spaceId: string,
    assetId: string,
    params: {
      sourceVariantId?: string;  // Optional: backend resolves from asset's active variant if not provided
      prompt: string;
      referenceAssetIds?: string[];  // Preferred: backend resolves to default variants
      referenceVariantIds?: string[]; // Fallback: explicit variant IDs
      aspectRatio?: string;
    }
  ): Promise<{
    success: boolean;
    jobId: string;
  }> {
    return this.fetch(`/api/spaces/${spaceId}/assets/${assetId}/variants`, {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  /**
   * Execute a pending action
   */
  async executeAction(spaceId: string, action: PendingAction): Promise<ActionResult> {
    const { tool, params } = action;

    try {
      switch (tool) {
        case 'generate_asset': {
          const result = await this.createAsset(spaceId, {
            name: params.name as string,
            type: params.type as string,
            prompt: params.prompt as string,
            // Prefer referenceAssetIds (backend resolves), fallback to referenceVariantIds
            referenceAssetIds: params.referenceAssetIds as string[] | undefined,
            referenceVariantIds: !params.referenceAssetIds ? params.referenceVariantIds as string[] | undefined : undefined,
            aspectRatio: params.aspectRatio as string | undefined,
          });
          return {
            success: true,
            assetId: result.assetId,
            assetName: params.name as string,
            variantId: result.variantId,
            jobId: result.jobId,
          };
        }

        case 'refine_asset': {
          const assetId = params.assetId as string;
          const result = await this.createVariant(spaceId, assetId, {
            // sourceVariantId is optional - backend resolves from asset's active variant if not provided
            sourceVariantId: params.sourceVariantId as string | undefined,
            prompt: params.prompt as string,
            referenceAssetIds: params.referenceAssetIds as string[] | undefined,
            aspectRatio: params.aspectRatio as string | undefined,
          });
          return {
            success: true,
            assetId,
            jobId: result.jobId,
          };
        }

        case 'combine_assets': {
          const result = await this.createAsset(spaceId, {
            name: params.name as string,
            type: params.type as string,
            prompt: params.prompt as string,
            // Use sourceAssetIds (backend resolves to default variants)
            referenceAssetIds: params.sourceAssetIds as string[],
            aspectRatio: params.aspectRatio as string | undefined,
          });
          return {
            success: true,
            assetId: result.assetId,
            assetName: params.name as string,
            variantId: result.variantId,
            jobId: result.jobId,
          };
        }

        default:
          return {
            success: false,
            error: `Unknown tool: ${tool}`,
          };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Poll job until completion
   */
  async waitForJob(jobId: string, timeoutMs = 120000, pollIntervalMs = 2000): Promise<JobResult> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const { job } = await this.getJob(jobId);

      switch (job.status) {
        case 'completed':
          return {
            status: 'completed',
            variantId: job.result_variant_id || undefined,
          };

        case 'failed':
          return {
            status: 'failed',
            error: job.error || 'Job failed',
          };

        case 'stuck':
          return {
            status: 'failed',
            error: 'Job stuck',
          };

        case 'pending':
        case 'processing':
          // Still in progress, continue polling
          break;

        default:
          // Unknown status, continue polling
          break;
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    return {
      status: 'timeout',
      error: `Job did not complete within ${timeoutMs}ms`,
    };
  }
}
