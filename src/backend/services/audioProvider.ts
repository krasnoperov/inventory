/**
 * Audio Generation Provider Interface
 *
 * Keeps website-controlled audio generation on the same workflow path as image
 * generation while allowing the concrete provider to be swapped later.
 */

export interface AudioGenerateOptions {
  prompt: string;
  model?: string;
}

export interface AudioSidecar {
  data: Uint8Array;
  mimeType: string;
}

export interface AudioGenerationResult {
  audioData: Uint8Array;
  audioMimeType: string;
  model: string;
  durationMs: number | null;
  transcript?: AudioSidecar;
  wordTimings?: AudioSidecar;
  renderMetadata?: AudioSidecar;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

export interface AudioGenerationProvider {
  generate(options: AudioGenerateOptions): Promise<AudioGenerationResult>;
}
