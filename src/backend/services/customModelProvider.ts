/**
 * Custom Model Provider
 *
 * Calls a self-hosted HTTP endpoint (e.g., Lambda/H100 running Qwen/Image-Edit)
 * for image generation. Implements the same ImageGenerationProvider interface
 * as NanoBananaService so it can be swapped in transparently.
 */

import type { ImageGenerationProvider } from './imageProvider';
import type {
  GenerateOptions,
  EditOptions,
  ComposeOptions,
  GenerationResult,
  ImageModel,
} from './nanoBananaService';

export class CustomModelProvider implements ImageGenerationProvider {
  constructor(
    private endpointUrl: string,
    private apiKey?: string
  ) {}

  async generate(options: GenerateOptions): Promise<GenerationResult> {
    const resp = await this.callEndpoint('/generate', {
      prompt: options.prompt,
      aspectRatio: options.aspectRatio,
      imageSize: options.imageSize,
    });
    return this.parseResponse(resp, options.aspectRatio, options.imageSize);
  }

  async edit(options: EditOptions): Promise<GenerationResult> {
    const resp = await this.callEndpoint('/edit', {
      image: {
        data: options.image.data,
        mimeType: options.image.mimeType,
      },
      prompt: options.prompt,
      aspectRatio: options.aspectRatio,
      imageSize: options.imageSize,
    });
    return this.parseResponse(resp, options.aspectRatio, options.imageSize);
  }

  async compose(options: ComposeOptions): Promise<GenerationResult> {
    const resp = await this.callEndpoint('/compose', {
      images: options.images.map((img) => ({
        data: img.data,
        mimeType: img.mimeType,
        label: img.label,
      })),
      prompt: options.prompt,
      aspectRatio: options.aspectRatio,
      imageSize: options.imageSize,
    });
    return this.parseResponse(resp, options.aspectRatio, options.imageSize);
  }

  private async callEndpoint(
    path: string,
    body: Record<string, unknown>
  ): Promise<Response> {
    const url = `${this.endpointUrl.replace(/\/$/, '')}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => 'Unknown error');
      throw new Error(`Custom model error (${resp.status}): ${text}`);
    }

    return resp;
  }

  private async parseResponse(
    resp: Response,
    aspectRatio?: string,
    imageSize?: string
  ): Promise<GenerationResult> {
    const data = await resp.json() as {
      imageData: string;
      imageMimeType?: string;
      usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
    };

    return {
      imageData: data.imageData,
      imageMimeType: data.imageMimeType || 'image/png',
      model: 'gemini-3-pro-image-preview' as ImageModel, // Placeholder — model name not relevant for custom
      aspectRatio: aspectRatio as GenerationResult['aspectRatio'],
      imageSize: imageSize as GenerationResult['imageSize'],
      usage: data.usage,
    };
  }
}
