/**
 * Image Generation Provider Interface
 *
 * Abstracts image generation so different backends (Gemini, custom fine-tuned models)
 * can be used interchangeably in the generation pipeline.
 */

import type {
  GenerateOptions,
  EditOptions,
  ComposeOptions,
  GenerationResult,
} from './nanoBananaService';

/**
 * Unified interface for image generation providers.
 * NanoBananaService (Gemini) and CustomModelProvider both implement this.
 */
export interface ImageGenerationProvider {
  generate(options: GenerateOptions): Promise<GenerationResult>;
  edit(options: EditOptions): Promise<GenerationResult>;
  compose(options: ComposeOptions): Promise<GenerationResult>;
}

/** Provider type identifier */
export type ModelProviderType = 'gemini' | 'custom';

// Re-export types for convenience
export type { GenerateOptions, EditOptions, ComposeOptions, GenerationResult };
