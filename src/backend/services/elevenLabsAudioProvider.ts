import type {
  AudioGenerateOptions,
  AudioGenerationProvider,
  AudioGenerationResult,
  AudioSidecar,
} from './audioProvider';
import { base64ToBuffer } from '../utils/image-utils';

type Fetcher = typeof fetch;

interface ElevenLabsAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

interface ElevenLabsVoiceSegment {
  voice_id: string;
  start_time_seconds: number;
  end_time_seconds: number;
  character_start_index: number;
  character_end_index: number;
  dialogue_input_index: number;
}

interface ElevenLabsTimingResponse {
  audio_base64: string;
  alignment?: ElevenLabsAlignment | null;
  normalized_alignment?: ElevenLabsAlignment | null;
  voice_segments?: ElevenLabsVoiceSegment[];
}

export interface ElevenLabsAudioProviderConfig {
  apiKey: string;
  voiceId: string;
  dialogueVoiceIds?: string[];
  modelId?: string;
  outputFormat?: string;
  fetcher?: Fetcher;
}

export interface ParsedDialogueLine {
  speaker: string;
  text: string;
}

export class ElevenLabsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = 'ElevenLabsApiError';
  }
}

const BASE_URL = 'https://api.elevenlabs.io/v1';
const DEFAULT_OUTPUT_FORMAT = 'mp3_44100_128';
const DEFAULT_MUSIC_MODEL = 'music_v1';
const DEFAULT_SOUND_EFFECT_MODEL = 'eleven_text_to_sound_v2';
const TEXT_ENCODER = new TextEncoder();

export function parseElevenLabsDialoguePrompt(prompt: string): ParsedDialogueLine[] | null {
  const lines = prompt
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return null;

  const parsed: ParsedDialogueLine[] = [];
  for (const line of lines) {
    const match = /^([^:\n]{1,64}):\s+(.+)$/.exec(line);
    if (!match) return null;
    parsed.push({
      speaker: match[1].trim(),
      text: match[2].trim(),
    });
  }

  const speakerCount = new Set(parsed.map(line => line.speaker)).size;
  return speakerCount >= 2 ? parsed : null;
}

export function getMimeTypeForElevenLabsOutputFormat(outputFormat: string): string {
  const codec = outputFormat.split('_')[0];
  switch (codec) {
    case 'mp3':
      return 'audio/mpeg';
    case 'wav':
      return 'audio/wav';
    case 'pcm':
      return 'audio/L16';
    case 'ulaw':
      return 'audio/basic';
    default:
      return 'application/octet-stream';
  }
}

export class ElevenLabsAudioProvider implements AudioGenerationProvider {
  private readonly fetcher: Fetcher;
  private readonly outputFormat: string;

  constructor(private readonly config: ElevenLabsAudioProviderConfig) {
    this.fetcher = config.fetcher ?? fetch;
    this.outputFormat = config.outputFormat ?? DEFAULT_OUTPUT_FORMAT;
  }

  async generate(options: AudioGenerateOptions): Promise<AudioGenerationResult> {
    const dialogue = parseElevenLabsDialoguePrompt(options.prompt);
    if (dialogue) {
      return this.generateDialogue(options, dialogue);
    }
    return this.generateSpeech(options);
  }

  private async generateSpeech(options: AudioGenerateOptions): Promise<AudioGenerationResult> {
    if (!this.config.voiceId) {
      throw new ElevenLabsApiError('ELEVENLABS_VOICE_ID is required for speech generation', 0, false);
    }

    const model = this.resolveModel();
    const response = await this.postWithTiming(
      `/text-to-speech/${encodeURIComponent(this.config.voiceId)}/with-timestamps`,
      {
        text: options.prompt,
        ...(model ? { model_id: model } : {}),
      }
    );

    return this.toAudioResult(response, {
      kind: 'speech',
      model,
      transcript: options.prompt,
      voices: [{ voiceId: this.config.voiceId }],
    });
  }

  private async generateDialogue(
    options: AudioGenerateOptions,
    dialogue: ParsedDialogueLine[]
  ): Promise<AudioGenerationResult> {
    const speakerVoiceIds = this.assignDialogueVoices(dialogue);
    const model = this.resolveModel();
    const inputs = dialogue.map(line => ({
      text: line.text,
      voice_id: speakerVoiceIds.get(line.speaker)!,
    }));

    const response = await this.postWithTiming('/text-to-dialogue/with-timestamps', {
      inputs,
      ...(model ? { model_id: model } : {}),
    });

    return this.toAudioResult(response, {
      kind: 'dialogue',
      model,
      transcript: dialogue.map(line => `${line.speaker}: ${line.text}`).join('\n'),
      voices: Array.from(speakerVoiceIds.entries()).map(([speaker, voiceId]) => ({ speaker, voiceId })),
      dialogueInputs: dialogue,
    });
  }

  private assignDialogueVoices(dialogue: ParsedDialogueLine[]): Map<string, string> {
    const speakers = Array.from(new Set(dialogue.map(line => line.speaker)));
    const voiceIds = this.config.dialogueVoiceIds?.length
      ? this.config.dialogueVoiceIds
      : [this.config.voiceId].filter(Boolean);

    if (voiceIds.length < speakers.length) {
      throw new ElevenLabsApiError(
        `ELEVENLABS_DIALOGUE_VOICE_IDS must include at least ${speakers.length} voice IDs for this dialogue`,
        0,
        false
      );
    }

    return new Map(speakers.map((speaker, index) => [speaker, voiceIds[index]]));
  }

  private resolveModel(): string | undefined {
    return this.config.modelId || undefined;
  }

  private async postWithTiming(path: string, body: unknown): Promise<ElevenLabsTimingResponse> {
    const url = new URL(`${BASE_URL}${path}`);
    url.searchParams.set('output_format', this.outputFormat);

    const response = await this.fetcher(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': this.config.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw await this.toApiError(response);
    }

    const payload = await response.json<ElevenLabsTimingResponse>();
    if (!payload.audio_base64) {
      throw new ElevenLabsApiError('ElevenLabs response did not include audio data', 502, true);
    }
    return payload;
  }

  private async toApiError(response: Response): Promise<ElevenLabsApiError> {
    return elevenLabsApiErrorFromResponse(response);
  }

  private toAudioResult(
    response: ElevenLabsTimingResponse,
    metadata: {
      kind: 'speech' | 'dialogue';
      model?: string;
      transcript: string;
      voices: Array<{ speaker?: string; voiceId: string }>;
      dialogueInputs?: ParsedDialogueLine[];
    }
  ): AudioGenerationResult {
    const timingPayload = {
      provider: 'elevenlabs',
      kind: metadata.kind,
      alignment: response.alignment ?? null,
      normalizedAlignment: response.normalized_alignment ?? null,
      voiceSegments: response.voice_segments ?? null,
    };
    const renderMetadata = {
      provider: 'elevenlabs',
      kind: metadata.kind,
      model: metadata.model ?? null,
      outputFormat: this.outputFormat,
      voices: metadata.voices,
      dialogueInputs: metadata.dialogueInputs,
    };

    return {
      audioData: base64ToBuffer(response.audio_base64),
      audioMimeType: getMimeTypeForElevenLabsOutputFormat(this.outputFormat),
      model: metadata.model ?? defaultModelForKind(metadata.kind),
      durationMs: getDurationMs(response),
      transcript: textSidecar(metadata.transcript, 'text/plain'),
      wordTimings: jsonSidecar(timingPayload),
      renderMetadata: jsonSidecar(renderMetadata),
    };
  }
}

export interface ElevenLabsGeneratedAudioProviderConfig {
  apiKey: string;
  modelId?: string;
  outputFormat?: string;
  fetcher?: Fetcher;
  baseUrl?: string;
}

abstract class BaseElevenLabsGeneratedAudioProvider implements AudioGenerationProvider {
  protected readonly fetcher: Fetcher;
  protected readonly baseUrl: string;
  protected readonly outputFormat: string;
  protected readonly modelId: string;

  constructor(
    protected readonly config: ElevenLabsGeneratedAudioProviderConfig,
    defaultModel: string
  ) {
    this.fetcher = config.fetcher ?? fetch;
    this.baseUrl = config.baseUrl?.replace(/\/$/, '') ?? BASE_URL;
    this.outputFormat = config.outputFormat ?? DEFAULT_OUTPUT_FORMAT;
    this.modelId = config.modelId ?? defaultModel;
  }

  abstract generate(options: AudioGenerateOptions): Promise<AudioGenerationResult>;

  protected async postAudio(
    path: string,
    body: Record<string, unknown>
  ): Promise<{ audioData: Uint8Array; audioMimeType: string; characterCost: number | null }> {
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.set('output_format', this.outputFormat);

    const response = await this.fetcher(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': this.config.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw await elevenLabsApiErrorFromResponse(response);
    }

    const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim()
      || getMimeTypeForElevenLabsOutputFormat(this.outputFormat);
    const characterCostHeader = response.headers.get('character-cost');
    const characterCost = characterCostHeader ? Number.parseInt(characterCostHeader, 10) : null;

    return {
      audioData: new Uint8Array(await response.arrayBuffer()),
      audioMimeType: contentType,
      characterCost: Number.isFinite(characterCost) ? characterCost : null,
    };
  }

  protected usageFromCharacterCost(characterCost: number | null): AudioGenerationResult['usage'] {
    if (characterCost === null) return undefined;
    return {
      inputTokens: characterCost,
      outputTokens: 0,
      totalTokens: characterCost,
    };
  }
}

export class ElevenLabsMusicProvider extends BaseElevenLabsGeneratedAudioProvider {
  constructor(config: ElevenLabsGeneratedAudioProviderConfig) {
    super(config, DEFAULT_MUSIC_MODEL);
  }

  async generate(options: AudioGenerateOptions): Promise<AudioGenerationResult> {
    const result = await this.postAudio('/music', {
      prompt: options.prompt,
      model_id: this.modelId,
    });

    return {
      audioData: result.audioData,
      audioMimeType: result.audioMimeType,
      model: this.modelId,
      durationMs: null,
      usage: this.usageFromCharacterCost(result.characterCost),
    };
  }
}

export class ElevenLabsSoundEffectProvider extends BaseElevenLabsGeneratedAudioProvider {
  constructor(config: ElevenLabsGeneratedAudioProviderConfig) {
    super(config, DEFAULT_SOUND_EFFECT_MODEL);
  }

  async generate(options: AudioGenerateOptions): Promise<AudioGenerationResult> {
    const result = await this.postAudio('/sound-generation', {
      text: options.prompt,
      model_id: this.modelId,
    });

    return {
      audioData: result.audioData,
      audioMimeType: result.audioMimeType,
      model: this.modelId,
      durationMs: null,
      usage: this.usageFromCharacterCost(result.characterCost),
    };
  }
}

function defaultModelForKind(kind: 'speech' | 'dialogue'): string {
  return kind === 'dialogue' ? 'eleven_v3' : 'eleven_multilingual_v2';
}

function getDurationMs(response: ElevenLabsTimingResponse): number | null {
  const candidates: number[] = [];
  const alignment = response.normalized_alignment ?? response.alignment;
  if (alignment?.character_end_times_seconds.length) {
    candidates.push(...alignment.character_end_times_seconds);
  }
  if (response.voice_segments?.length) {
    candidates.push(...response.voice_segments.map(segment => segment.end_time_seconds));
  }
  if (candidates.length === 0) return null;
  return Math.round(Math.max(...candidates) * 1000);
}

function textSidecar(text: string, mimeType: string): AudioSidecar {
  return {
    data: TEXT_ENCODER.encode(text),
    mimeType,
  };
}

function jsonSidecar(value: unknown): AudioSidecar {
  return textSidecar(JSON.stringify(value, null, 2), 'application/json');
}

async function elevenLabsApiErrorFromResponse(response: Response): Promise<ElevenLabsApiError> {
  let body = '';
  try {
    body = await response.text();
  } catch {
    // Ignore body read errors; status is still enough to classify retries.
  }
  const detail = extractErrorDetail(body);
  const retryable = response.status === 429 || response.status >= 500;
  return new ElevenLabsApiError(
    `ElevenLabs audio generation failed (${response.status})${detail ? `: ${detail}` : ''}`,
    response.status,
    retryable
  );
}

function extractErrorDetail(body: string): string | null {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body) as { detail?: unknown; message?: unknown };
    const detail = parsed.detail ?? parsed.message;
    if (typeof detail === 'string') return detail;
    if (detail && typeof detail === 'object') return JSON.stringify(detail);
  } catch {
    return body.slice(0, 500);
  }
  return null;
}
