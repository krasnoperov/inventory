/**
 * Vision Controller
 *
 * Handles describe and compare operations for images using Claude vision.
 * Non-blocking async processing with responses sent via WebSocket.
 */

import type { DescribeRequestMessage, CompareRequestMessage } from '../../../workflows/types';
import { ClaudeService } from '../../../services/claudeService';
import {
  processDescribe,
  processCompare,
  hasApiKey,
  hasStorage,
  type VisionDependencies,
} from '../vision/VisionService';
import { BaseController, type ControllerContext, ValidationError } from './types';

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
      console.error('[VisionController] Error processing describe request:', error);
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
      console.error('[VisionController] Error processing compare request:', error);
      this.send(ws, {
        type: 'compare:response',
        requestId: msg.requestId,
        success: false,
        error: error instanceof Error ? error.message : 'Failed to compare images',
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
      this.send(ws, {
        type: 'describe:response',
        requestId: msg.requestId,
        success: true,
        description: result.description,
        usage: result.usage,
      });
    } else {
      this.send(ws, {
        type: 'describe:response',
        requestId: msg.requestId,
        success: false,
        error: result.error,
      });
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

    // Build dependencies and process
    const deps = this.buildVisionDependencies();
    const result = await processCompare({ variantIds: msg.variantIds, aspects: msg.aspects }, deps);

    if (result.success) {
      this.send(ws, {
        type: 'compare:response',
        requestId: msg.requestId,
        success: true,
        comparison: result.comparison,
        usage: result.usage,
      });
    } else {
      this.send(ws, {
        type: 'compare:response',
        requestId: msg.requestId,
        success: false,
        error: result.error,
      });
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
