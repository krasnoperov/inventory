import type {
  AudioGenerateOptions,
  AudioGenerationProvider,
  AudioGenerationResult,
  AudioSidecar,
} from './audioProvider';
import { base64ToBuffer } from '../utils/image-utils';

type Fetcher = typeof fetch;

export interface LyriaMusicProviderConfig {
  projectId: string;
  accessToken?: string;
  apiKey?: string;
  location?: string;
  modelId?: string;
  fetcher?: Fetcher;
  baseUrl?: string;
}

interface LyriaInteractionOutput {
  type?: string;
  text?: string;
  data?: string;
  mime_type?: string;
}

interface LyriaInteractionResponse {
  status?: string;
  outputs?: LyriaInteractionOutput[];
  model?: string;
  created?: string;
  updated?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: {
    message?: string;
  };
}

interface LyriaPredictResponse {
  predictions?: Array<{
    audioContent?: string;
    mimeType?: string;
  }>;
  model?: string;
  modelDisplayName?: string;
  deployedModelId?: string;
}

export class LyriaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = 'LyriaApiError';
  }
}

const DEFAULT_LOCATION = 'global';
const DEFAULT_MODEL = 'lyria-3-clip-preview';
const TEXT_ENCODER = new TextEncoder();

export class LyriaMusicProvider implements AudioGenerationProvider {
  private readonly fetcher: Fetcher;
  private readonly baseUrl: string;
  private readonly location: string;
  private readonly modelId: string;

  constructor(private readonly config: LyriaMusicProviderConfig) {
    this.fetcher = config.fetcher ?? fetch;
    this.baseUrl = config.baseUrl?.replace(/\/$/, '') ?? 'https://aiplatform.googleapis.com';
    this.location = config.location ?? DEFAULT_LOCATION;
    this.modelId = config.modelId ?? DEFAULT_MODEL;
  }

  async generate(options: AudioGenerateOptions): Promise<AudioGenerationResult> {
    if (!options.prompt.trim()) {
      throw new LyriaApiError('Prompt is required for Lyria music generation', 0, false);
    }
    if (!this.config.projectId.trim()) {
      throw new LyriaApiError('LYRIA_PROJECT_ID is required for Lyria music generation', 0, false);
    }
    if (!this.config.accessToken && !this.config.apiKey) {
      throw new LyriaApiError('LYRIA_ACCESS_TOKEN or LYRIA_API_KEY is required for Lyria music generation', 0, false);
    }

    return this.modelId === 'lyria-002'
      ? this.generateLyria2(options)
      : this.generateLyria3(options);
  }

  private async generateLyria3(options: AudioGenerateOptions): Promise<AudioGenerationResult> {
    const response = await this.postJson<LyriaInteractionResponse>(
      `/v1beta1/projects/${encodeURIComponent(this.config.projectId)}/locations/${encodeURIComponent(this.location)}/interactions`,
      {
        model: this.modelId,
        input: [
          {
            type: 'text',
            text: options.prompt,
          },
        ],
      }
    );

    if (response.status && response.status !== 'completed') {
      throw new LyriaApiError(
        response.error?.message || `Lyria interaction finished with status ${response.status}`,
        502,
        response.status === 'in_progress'
      );
    }

    const audio = response.outputs?.find(output => output.type === 'audio' && output.data);
    if (!audio?.data) {
      throw new LyriaApiError('Lyria response did not include audio data', 502, true);
    }

    const description = response.outputs
      ?.filter(output => output.type === 'text' && output.text)
      .map(output => output.text)
      .join('\n\n');

    return {
      audioData: base64ToBuffer(audio.data),
      audioMimeType: audio.mime_type || 'audio/mpeg',
      model: response.model || this.modelId,
      durationMs: null,
      usage: usageFromLyria(response.usage),
      renderMetadata: jsonSidecar({
        provider: 'lyria',
        model: response.model || this.modelId,
        status: response.status ?? null,
        created: response.created ?? null,
        updated: response.updated ?? null,
        description: description || null,
      }),
    };
  }

  private async generateLyria2(options: AudioGenerateOptions): Promise<AudioGenerationResult> {
    const response = await this.postJson<LyriaPredictResponse>(
      `/v1/projects/${encodeURIComponent(this.config.projectId)}/locations/${encodeURIComponent(this.location)}/publishers/google/models/lyria-002:predict`,
      {
        instances: [
          {
            prompt: options.prompt,
          },
        ],
        parameters: {
          sample_count: 1,
        },
      }
    );

    const prediction = response.predictions?.find(candidate => candidate.audioContent);
    if (!prediction?.audioContent) {
      throw new LyriaApiError('Lyria response did not include audio data', 502, true);
    }

    return {
      audioData: base64ToBuffer(prediction.audioContent),
      audioMimeType: prediction.mimeType || 'audio/wav',
      model: response.model || this.modelId,
      durationMs: 32_800,
      renderMetadata: jsonSidecar({
        provider: 'lyria',
        model: response.model || this.modelId,
        modelDisplayName: response.modelDisplayName ?? null,
        deployedModelId: response.deployedModelId ?? null,
      }),
    };
  }

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (this.config.apiKey && !this.config.accessToken) {
      url.searchParams.set('key', this.config.apiKey);
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.accessToken) {
      headers.Authorization = `Bearer ${this.config.accessToken}`;
    }

    const response = await this.fetcher(url.toString(), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw await lyriaApiErrorFromResponse(response);
    }

    return response.json<T>();
  }
}

function usageFromLyria(usage: LyriaInteractionResponse['usage']): AudioGenerationResult['usage'] {
  const inputTokens = usage?.input_tokens ?? usage?.promptTokenCount;
  const outputTokens = usage?.output_tokens ?? usage?.candidatesTokenCount;
  const totalTokens = usage?.total_tokens ?? usage?.totalTokenCount;
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) {
    return undefined;
  }

  return {
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    totalTokens: totalTokens ?? (inputTokens ?? 0) + (outputTokens ?? 0),
  };
}

function jsonSidecar(value: unknown): AudioSidecar {
  return {
    data: TEXT_ENCODER.encode(JSON.stringify(value, null, 2)),
    mimeType: 'application/json',
  };
}

async function lyriaApiErrorFromResponse(response: Response): Promise<LyriaApiError> {
  let message = `Lyria API request failed (${response.status})`;
  try {
    const body = await response.json<{ error?: { message?: string }; message?: string }>();
    message = body.error?.message || body.message || message;
  } catch {
    try {
      const text = await response.text();
      if (text) message = text;
    } catch {
      // Status is enough to classify retries.
    }
  }

  const retryable = response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500;
  return new LyriaApiError(message, response.status, retryable);
}
