/**
 * Vision Controller
 *
 * Handles describe and compare operations for images using Claude vision.
 * Non-blocking async processing with responses sent via WebSocket.
 */

import type {
  DescribeRequestMessage,
  CompareRequestMessage,
  EnhanceRequestMessage,
  AutoDescribeRequestMessage,
  ForgeChatRequestMessage,
} from '../../../workflows/types';
import { ClaudeService } from '../../../services/claudeService';
import {
  processDescribe,
  processCompare,
  hasApiKey,
  hasStorage,
  type VisionDependencies,
} from '../vision/VisionService';
import { BaseController, type ControllerContext } from './types';
import type { Variant } from '../types';
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

  /**
   * Handle auto-describe:request WebSocket message
   * Auto-describes a variant and caches the description in the database.
   * Triggered when a variant is added to ForgeTray.
   */
  async handleAutoDescribe(ws: WebSocket, msg: AutoDescribeRequestMessage): Promise<void> {
    this.processAutoDescribeRequest(ws, msg).catch((error) => {
      log.error('Error processing auto-describe request', {
        requestId: msg.requestId,
        spaceId: this.spaceId,
        variantId: msg.variantId,
        error: error instanceof Error ? error.message : String(error),
      });
      this.send(ws, {
        type: 'auto-describe:response',
        requestId: msg.requestId,
        variantId: msg.variantId,
        success: false,
        error: error instanceof Error ? error.message : 'Failed to describe image',
      });
    });
  }

  /**
   * Handle forge-chat:request WebSocket message
   * Multi-turn chat for prompt refinement with variant context.
   */
  async handleForgeChat(ws: WebSocket, msg: ForgeChatRequestMessage): Promise<void> {
    this.processForgeChatRequest(ws, msg).catch((error) => {
      log.error('Error processing forge-chat request', {
        requestId: msg.requestId,
        spaceId: this.spaceId,
        error: error instanceof Error ? error.message : String(error),
      });
      this.send(ws, {
        type: 'forge-chat:response',
        requestId: msg.requestId,
        success: false,
        error: error instanceof Error ? error.message : 'Failed to process chat',
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
      hasSlots: (msg.slotVariantIds?.length ?? 0) > 0,
    });

    try {
      const claudeService = new ClaudeService(this.env.ANTHROPIC_API_KEY!);

      // Check if we have slot variants for vision-aware enhancement
      if (msg.slotVariantIds && msg.slotVariantIds.length > 0) {
        const variantDescriptions = await this.getVariantDescriptions(msg.slotVariantIds);

        if (variantDescriptions.length > 0) {
          // Use vision-aware enhancement with context
          const result = await claudeService.enhancePromptWithContext(
            msg.prompt.trim(),
            variantDescriptions
          );

          timer(true, {
            originalLength: msg.prompt.length,
            enhancedLength: result.enhancedPrompt.length,
            outputTokens: result.usage.outputTokens,
            visionAware: true,
            descriptionsUsed: variantDescriptions.length,
          });

          this.send(ws, {
            type: 'enhance:response',
            requestId: msg.requestId,
            success: true,
            enhancedPrompt: result.enhancedPrompt,
            usage: result.usage,
          });
          return;
        }
      }

      // Fall back to standard enhancement (no vision context)
      const result = await claudeService.enhancePromptForGemini(msg.prompt.trim());

      timer(true, {
        originalLength: msg.prompt.length,
        enhancedLength: result.enhancedPrompt.length,
        outputTokens: result.usage.outputTokens,
        visionAware: false,
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

  private async processAutoDescribeRequest(ws: WebSocket, msg: AutoDescribeRequestMessage): Promise<void> {
    // Check prerequisites
    if (!hasApiKey(this.env.ANTHROPIC_API_KEY)) {
      this.send(ws, {
        type: 'auto-describe:response',
        requestId: msg.requestId,
        variantId: msg.variantId,
        success: false,
        error: 'Claude API not configured',
      });
      return;
    }

    if (!hasStorage(this.env.IMAGES)) {
      this.send(ws, {
        type: 'auto-describe:response',
        requestId: msg.requestId,
        variantId: msg.variantId,
        success: false,
        error: 'Image storage not configured',
      });
      return;
    }

    // Check if description already cached
    const existingResult = await this.sql.exec(
      'SELECT description FROM variants WHERE id = ?',
      msg.variantId
    );
    const existing = existingResult.toArray()[0] as { description: string | null } | undefined;

    if (existing?.description) {
      // Already have cached description - return it
      this.send(ws, {
        type: 'auto-describe:response',
        requestId: msg.requestId,
        variantId: msg.variantId,
        success: true,
        description: existing.description,
      });
      return;
    }

    const timer = log.startTimer('Auto-describe variant', {
      requestId: msg.requestId,
      spaceId: this.spaceId,
      variantId: msg.variantId,
    });

    try {
      // Get variant with asset name
      const deps = this.buildVisionDependencies();
      const variantWithAsset = await deps.getVariantWithAsset(msg.variantId);

      if (!variantWithAsset) {
        timer(false, { error: 'Variant not found' });
        this.send(ws, {
          type: 'auto-describe:response',
          requestId: msg.requestId,
          variantId: msg.variantId,
          success: false,
          error: 'Variant not found',
        });
        return;
      }

      // Generate description using processDescribe with 'prompt' focus
      const result = await processDescribe(
        {
          variantId: msg.variantId,
          assetName: variantWithAsset.asset_name,
          focus: 'prompt', // Use 'prompt' focus for generation-oriented descriptions
        },
        deps
      );

      if (result.success) {
        // Cache the description in the database
        await this.sql.exec(
          'UPDATE variants SET description = ?, updated_at = ? WHERE id = ?',
          result.description,
          Date.now(),
          msg.variantId
        );

        // Broadcast variant update to all clients
        const updatedVariant = await this.sql.exec(
          `SELECT * FROM variants WHERE id = ?`,
          msg.variantId
        );
        const variantRow = updatedVariant.toArray()[0] as Variant | undefined;
        if (variantRow) {
          this.broadcast({
            type: 'variant:updated',
            variant: {
              ...variantRow,
              starred: Boolean(variantRow.starred),
            },
          });
        }

        timer(true, {
          descriptionLength: result.description.length,
          outputTokens: result.usage?.outputTokens,
        });

        this.send(ws, {
          type: 'auto-describe:response',
          requestId: msg.requestId,
          variantId: msg.variantId,
          success: true,
          description: result.description,
        });
      } else {
        timer(false, { error: result.error });
        this.send(ws, {
          type: 'auto-describe:response',
          requestId: msg.requestId,
          variantId: msg.variantId,
          success: false,
          error: result.error,
        });
      }
    } catch (error) {
      timer(false, { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  private async processForgeChatRequest(ws: WebSocket, msg: ForgeChatRequestMessage): Promise<void> {
    // Check prerequisites
    if (!hasApiKey(this.env.ANTHROPIC_API_KEY)) {
      this.send(ws, {
        type: 'forge-chat:response',
        requestId: msg.requestId,
        success: false,
        error: 'Claude API not configured',
      });
      return;
    }

    // Validate message is not empty
    if (!msg.message || msg.message.trim().length === 0) {
      this.send(ws, {
        type: 'forge-chat:response',
        requestId: msg.requestId,
        success: false,
        error: 'Message cannot be empty',
      });
      return;
    }

    const timer = log.startTimer('Forge chat', {
      requestId: msg.requestId,
      spaceId: this.spaceId,
      slotCount: msg.slotVariantIds.length,
      historyLength: msg.conversationHistory.length,
    });

    try {
      const claudeService = new ClaudeService(this.env.ANTHROPIC_API_KEY!);
      const isFirstMessage = msg.conversationHistory.length === 0;
      const hasImages = msg.slotVariantIds.length > 0 && hasStorage(this.env.IMAGES);

      // Collect descriptions and images for context
      const variantDescriptions: Array<{ variantId: string; assetName: string; description: string }> = [];
      const collectedDescriptions: Array<{ variantId: string; assetName: string; description: string; cached: boolean }> = [];
      let images: Array<{ base64: string; mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; assetName: string }> | undefined;

      // For first message with images, generate descriptions on-demand with progress updates
      if (isFirstMessage && hasImages) {
        const total = msg.slotVariantIds.length;

        for (let i = 0; i < msg.slotVariantIds.length; i++) {
          const variantId = msg.slotVariantIds[i];
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
              type: 'forge-chat:progress',
              requestId: msg.requestId,
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
              type: 'forge-chat:progress',
              requestId: msg.requestId,
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
                type: 'forge-chat:progress',
                requestId: msg.requestId,
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
        images = await this.getVariantImages(msg.slotVariantIds);
      } else {
        // Follow-up message: just get cached descriptions (no progress needed)
        const cached = await this.getVariantDescriptions(msg.slotVariantIds);
        variantDescriptions.push(...cached);
      }

      // Now call Claude with all context
      const result = await claudeService.forgeChat(
        msg.message.trim(),
        msg.currentPrompt,
        variantDescriptions,
        msg.conversationHistory,
        images
      );

      timer(true, {
        responseLength: result.message.length,
        hasSuggestedPrompt: !!result.suggestedPrompt,
        outputTokens: result.usage.outputTokens,
        descriptionsUsed: variantDescriptions.length,
        imagesAttached: images?.length ?? 0,
        descriptionsGenerated: collectedDescriptions.filter(d => !d.cached).length,
      });

      this.send(ws, {
        type: 'forge-chat:response',
        requestId: msg.requestId,
        success: true,
        message: result.message,
        suggestedPrompt: result.suggestedPrompt,
        usage: result.usage,
        descriptions: collectedDescriptions.length > 0 ? collectedDescriptions : undefined,
      });
    } catch (error) {
      timer(false, { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
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
   * Returns base64 encoded images for attaching to Claude messages
   */
  private async getVariantImages(
    variantIds: string[]
  ): Promise<Array<{ base64: string; mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; assetName: string }>> {
    const images: Array<{ base64: string; mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; assetName: string }> = [];

    for (const variantId of variantIds) {
      // Get variant with image key and asset name
      const result = await this.sql.exec(
        `SELECT v.image_key, a.name as asset_name
         FROM variants v
         JOIN assets a ON v.asset_id = a.id
         WHERE v.id = ? AND v.image_key IS NOT NULL`,
        variantId
      );
      const row = result.toArray()[0] as { image_key: string; asset_name: string } | undefined;

      if (row?.image_key) {
        // Fetch image from R2
        const obj = await this.env.IMAGES!.get(row.image_key);
        if (obj) {
          const buffer = await obj.arrayBuffer();
          // Convert to base64 in chunks to avoid stack overflow with large images
          const bytes = new Uint8Array(buffer);
          let binary = '';
          const chunkSize = 8192;
          for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
            binary += String.fromCharCode.apply(null, Array.from(chunk));
          }
          const base64 = btoa(binary);

          // Determine media type from key extension or default to jpeg
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
