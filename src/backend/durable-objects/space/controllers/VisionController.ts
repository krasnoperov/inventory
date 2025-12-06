/**
 * Vision Controller
 *
 * Handles describe and compare operations for images using Claude vision.
 * Non-blocking async processing with responses sent via WebSocket.
 */

import type { DescribeRequestMessage, CompareRequestMessage, EnhanceRequestMessage } from '../../../workflows/types';
import { ClaudeService } from '../../../services/claudeService';
import {
  processDescribe,
  processCompare,
  hasApiKey,
  hasStorage,
  type VisionDependencies,
} from '../vision/VisionService';
import { BaseController, type ControllerContext } from './types';
import { loggers } from '../../../../shared/logger';

const log = loggers.visionController;

export class VisionController extends BaseController {
  constructor(ctx: ControllerContext) {
    super(ctx);
  }

  /**
   * Handle describe:request WebSocket message
   * Non-blocking: processes async and sends response when ready
   */
  async handleDescribe(ws: WebSocket, msg: DescribeRequestMessage): Promise<void> {
    // Process async - don't block the WebSocket handler
    this.processDescribeRequest(ws, msg).catch((error) => {
      log.error('Error processing describe request', {
        requestId: msg.requestId,
        spaceId: this.spaceId,
        variantId: msg.variantId,
        error: error instanceof Error ? error.message : String(error),
      });
      this.send(ws, {
        type: 'describe:response',
        requestId: msg.requestId,
        success: false,
        error: error instanceof Error ? error.message : 'Failed to describe image',
      });
    });
  }

  /**
   * Handle compare:request WebSocket message
   * Non-blocking: processes async and sends response when ready
   */
  async handleCompare(ws: WebSocket, msg: CompareRequestMessage): Promise<void> {
    // Process async - don't block the WebSocket handler
    this.processCompareRequest(ws, msg).catch((error) => {
      log.error('Error processing compare request', {
        requestId: msg.requestId,
        spaceId: this.spaceId,
        variantIds: msg.variantIds,
        error: error instanceof Error ? error.message : String(error),
      });
      this.send(ws, {
        type: 'compare:response',
        requestId: msg.requestId,
        success: false,
        error: error instanceof Error ? error.message : 'Failed to compare images',
      });
    });
  }

  /**
   * Handle enhance:request WebSocket message
   * Non-blocking: processes async and sends response when ready
   */
  async handleEnhance(ws: WebSocket, msg: EnhanceRequestMessage): Promise<void> {
    // Process async - don't block the WebSocket handler
    this.processEnhanceRequest(ws, msg).catch((error) => {
      log.error('Error processing enhance request', {
        requestId: msg.requestId,
        spaceId: this.spaceId,
        enhanceType: msg.enhanceType,
        error: error instanceof Error ? error.message : String(error),
      });
      this.send(ws, {
        type: 'enhance:response',
        requestId: msg.requestId,
        success: false,
        error: error instanceof Error ? error.message : 'Failed to enhance prompt',
      });
    });
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private async processDescribeRequest(ws: WebSocket, msg: DescribeRequestMessage): Promise<void> {
    // Check prerequisites
    if (!hasApiKey(this.env.ANTHROPIC_API_KEY)) {
      this.send(ws, {
        type: 'describe:response',
        requestId: msg.requestId,
        success: false,
        error: 'Bot assistant not configured',
      });
      return;
    }

    if (!hasStorage(this.env.IMAGES)) {
      this.send(ws, {
        type: 'describe:response',
        requestId: msg.requestId,
        success: false,
        error: 'Image storage not configured',
      });
      return;
    }

    const timer = log.startTimer('Vision describe', {
      requestId: msg.requestId,
      spaceId: this.spaceId,
      variantId: msg.variantId,
    });

    try {
      // Build dependencies and process
      const deps = this.buildVisionDependencies();
      const result = await processDescribe(
        {
          variantId: msg.variantId,
          assetName: msg.assetName,
          focus: msg.focus,
          question: msg.question,
        },
        deps
      );

      if (result.success) {
        timer(true, {
          descriptionLength: result.description?.length || 0,
          outputTokens: result.usage?.outputTokens,
        });
        this.send(ws, {
          type: 'describe:response',
          requestId: msg.requestId,
          success: true,
          description: result.description,
          usage: result.usage,
        });
      } else {
        timer(false, { error: result.error });
        this.send(ws, {
          type: 'describe:response',
          requestId: msg.requestId,
          success: false,
          error: result.error,
        });
      }
    } catch (error) {
      timer(false, { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  private async processCompareRequest(ws: WebSocket, msg: CompareRequestMessage): Promise<void> {
    // Check prerequisites
    if (!hasApiKey(this.env.ANTHROPIC_API_KEY)) {
      this.send(ws, {
        type: 'compare:response',
        requestId: msg.requestId,
        success: false,
        error: 'Bot assistant not configured',
      });
      return;
    }

    if (!hasStorage(this.env.IMAGES)) {
      this.send(ws, {
        type: 'compare:response',
        requestId: msg.requestId,
        success: false,
        error: 'Image storage not configured',
      });
      return;
    }

    const timer = log.startTimer('Vision compare', {
      requestId: msg.requestId,
      spaceId: this.spaceId,
      variantCount: msg.variantIds.length,
    });

    try {
      // Build dependencies and process
      const deps = this.buildVisionDependencies();
      const result = await processCompare({ variantIds: msg.variantIds, aspects: msg.aspects }, deps);

      if (result.success) {
        timer(true, {
          comparisonLength: result.comparison?.length || 0,
          outputTokens: result.usage?.outputTokens,
        });
        this.send(ws, {
          type: 'compare:response',
          requestId: msg.requestId,
          success: true,
          comparison: result.comparison,
          usage: result.usage,
        });
      } else {
        timer(false, { error: result.error });
        this.send(ws, {
          type: 'compare:response',
          requestId: msg.requestId,
          success: false,
          error: result.error,
        });
      }
    } catch (error) {
      timer(false, { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  private async processEnhanceRequest(ws: WebSocket, msg: EnhanceRequestMessage): Promise<void> {
    // Check prerequisites
    if (!hasApiKey(this.env.ANTHROPIC_API_KEY)) {
      this.send(ws, {
        type: 'enhance:response',
        requestId: msg.requestId,
        success: false,
        error: 'Claude API not configured',
      });
      return;
    }

    // Validate prompt is not empty
    if (!msg.prompt || msg.prompt.trim().length === 0) {
      this.send(ws, {
        type: 'enhance:response',
        requestId: msg.requestId,
        success: false,
        error: 'Prompt cannot be empty',
      });
      return;
    }

    const timer = log.startTimer('Prompt enhance', {
      requestId: msg.requestId,
      spaceId: this.spaceId,
      enhanceType: msg.enhanceType,
    });

    try {
      const claudeService = new ClaudeService(this.env.ANTHROPIC_API_KEY!);
      const result = await claudeService.enhancePromptForGemini(msg.prompt.trim());

      timer(true, {
        originalLength: msg.prompt.length,
        enhancedLength: result.enhancedPrompt.length,
        outputTokens: result.usage.outputTokens,
      });

      this.send(ws, {
        type: 'enhance:response',
        requestId: msg.requestId,
        success: true,
        enhancedPrompt: result.enhancedPrompt,
        usage: result.usage,
      });
    } catch (error) {
      timer(false, { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Build vision dependencies with injected SQL queries and services.
   * Centralizes the dependency creation to eliminate duplication.
   */
  private buildVisionDependencies(): VisionDependencies {
    const claudeService = new ClaudeService(this.env.ANTHROPIC_API_KEY!);

    return {
      getVariant: async (id) => {
        const result = await this.sql.exec('SELECT image_key FROM variants WHERE id = ?', id);
        return result.toArray()[0] as { image_key: string } | null;
      },
      getVariantWithAsset: async (id) => {
        const result = await this.sql.exec(
          `SELECT v.image_key, a.name as asset_name
           FROM variants v
           JOIN assets a ON v.asset_id = a.id
           WHERE v.id = ?`,
          id
        );
        return result.toArray()[0] as { image_key: string; asset_name: string } | null;
      },
      getImage: async (key) => {
        const obj = await this.env.IMAGES!.get(key);
        return obj ? await obj.arrayBuffer() : null;
      },
      describeImage: claudeService.describeImage.bind(claudeService),
      compareImages: claudeService.compareImages.bind(claudeService),
    };
  }
}
