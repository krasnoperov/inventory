import { injectable } from 'inversify';
import { GoogleGenAI, createPartFromBase64, createPartFromText, type Part } from '@google/genai';

// =============================================================================
// Core Types - Pure data, no framework dependencies
// =============================================================================

export type ImageModel = 'gemini-3-pro-image-preview' | 'gemini-2.5-flash-image';
export type AspectRatio = '1:1' | '16:9' | '9:16' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '21:9';
export type ImageSize = '1K' | '2K' | '4K';

export interface ImageInput {
  data: string;      // base64 encoded
  mimeType: string;  // e.g., 'image/png'
  label?: string;    // e.g., 'Image 1:', 'Character:' for structured prompts
}

export interface GenerateOptions {
  prompt: string;
  model?: ImageModel;
  aspectRatio?: AspectRatio;
  imageSize?: ImageSize;
}

export interface EditOptions {
  image: ImageInput;
  prompt: string;
  model?: ImageModel;
  aspectRatio?: AspectRatio;
  imageSize?: ImageSize;
}

export interface ComposeOptions {
  images: ImageInput[];
  prompt: string;
  model?: ImageModel;
  aspectRatio?: AspectRatio;
  imageSize?: ImageSize;
}

export interface GenerationResult {
  imageData: string;    // base64 encoded
  imageMimeType: string;
  // Echo back what was used (for Recipe storage)
  model: ImageModel;
  aspectRatio?: AspectRatio;
  imageSize?: ImageSize;
  // Token usage for billing
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

// =============================================================================
// Service - Pure Gemini API wrapper
// =============================================================================

/**
 * Core image generation service using Google Gemini.
 *
 * This is a pure service with no side effects:
 * - No R2 storage
 * - No database access
 * - No job tracking
 *
 * External "gears" (routes, queue workers) handle:
 * - Storage (R2)
 * - Job management (D1/Queue)
 * - Recipe tracking
 * - Thumbnail generation
 */
@injectable()
export class NanoBananaService {
  private readonly DEFAULT_MODEL: ImageModel = 'gemini-3-pro-image-preview';
  private readonly ai: GoogleGenAI;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('Google AI API key is required');
    }
    this.ai = new GoogleGenAI({ apiKey });
  }

  /**
   * Generate image from text prompt
   */
  async generate(options: GenerateOptions): Promise<GenerationResult> {
    const { prompt, model = this.DEFAULT_MODEL, aspectRatio, imageSize } = options;

    if (!prompt) {
      throw new Error('Prompt is required');
    }

    const response = await this.ai.models.generateContent({
      model,
      contents: prompt,
      config: this.buildConfig(aspectRatio, imageSize),
    });

    return this.extractResult(response, model, aspectRatio, imageSize);
  }

  /**
   * Edit existing image with instructions
   */
  async edit(options: EditOptions): Promise<GenerationResult> {
    const { image, prompt, model = this.DEFAULT_MODEL, aspectRatio, imageSize } = options;

    if (!image?.data || !image?.mimeType) {
      throw new Error('Image data and mimeType are required');
    }
    if (!prompt) {
      throw new Error('Prompt is required');
    }

    const parts: Part[] = [
      createPartFromBase64(image.data, image.mimeType),
      createPartFromText(prompt),
    ];

    const response = await this.ai.models.generateContent({
      model,
      contents: parts,
      config: this.buildConfig(aspectRatio, imageSize),
    });

    return this.extractResult(response, model, aspectRatio, imageSize);
  }

  /**
   * Compose multiple images into new image
   *
   * Supports structured prompts with labels:
   * - "Image 1: robot character"
   * - "Image 2: glowing sword"
   * - "Scene: robot holding sword"
   */
  async compose(options: ComposeOptions): Promise<GenerationResult> {
    const { images, prompt, model = this.DEFAULT_MODEL, aspectRatio, imageSize } = options;

    if (!images || images.length === 0) {
      throw new Error('At least one image is required');
    }
    if (!prompt) {
      throw new Error('Prompt is required');
    }

    // Validate model constraints
    if (model === 'gemini-2.5-flash-image' && images.length > 1) {
      throw new Error('gemini-2.5-flash-image supports only 1 reference image');
    }
    if (images.length > 14) {
      throw new Error('Maximum 14 reference images supported');
    }

    // Build structured prompt with labels if provided
    const labeledPrompt = this.buildLabeledPrompt(images, prompt);

    const parts: Part[] = [
      ...images.map(img => createPartFromBase64(img.data, img.mimeType)),
      createPartFromText(labeledPrompt),
    ];

    const response = await this.ai.models.generateContent({
      model,
      contents: parts,
      config: this.buildConfig(aspectRatio, imageSize),
    });

    return this.extractResult(response, model, aspectRatio, imageSize);
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  private buildConfig(aspectRatio?: AspectRatio, imageSize?: ImageSize): Record<string, unknown> | undefined {
    const config: Record<string, unknown> = {};

    if (aspectRatio) {
      config.aspectRatio = aspectRatio;
    }
    if (imageSize) {
      config.imageSize = imageSize;
    }

    return Object.keys(config).length > 0 ? config : undefined;
  }

  private buildLabeledPrompt(images: ImageInput[], prompt: string): string {
    const hasLabels = images.some(img => img.label);
    if (!hasLabels) {
      return prompt;
    }

    // Build structured prompt: labels first, then user prompt
    const labelLines = images
      .map((img, i) => img.label || `Image ${i + 1}:`)
      .map((label, i) => `${label} [reference image ${i + 1}]`)
      .join('\n');

    return `${labelLines}\n\n${prompt}`;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractResult(response: any, model: ImageModel, aspectRatio?: AspectRatio, imageSize?: ImageSize): GenerationResult {
    if (!response.candidates || response.candidates.length === 0) {
      throw new Error('No image generated: empty response');
    }

    const candidate = response.candidates[0];
    if (!candidate.content?.parts || candidate.content.parts.length === 0) {
      throw new Error('No image generated: no content parts');
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const imagePart = candidate.content.parts.find((part: any) => part.inlineData);
    if (!imagePart?.inlineData?.data) {
      throw new Error('No image generated: no inline data');
    }

    const { mimeType, data } = imagePart.inlineData;

    // Extract token usage if available
    const usageMetadata = response.usageMetadata;
    const usage = usageMetadata
      ? {
          inputTokens: usageMetadata.promptTokenCount || 0,
          outputTokens: usageMetadata.candidatesTokenCount || 0,
          totalTokens: usageMetadata.totalTokenCount || 0,
        }
      : undefined;

    return {
      imageData: data,
      imageMimeType: mimeType || 'image/webp',
      model,
      aspectRatio,
      imageSize,
      usage,
    };
  }
}
