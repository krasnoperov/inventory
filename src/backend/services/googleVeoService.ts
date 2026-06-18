import {
  GoogleGenAI,
  VideoGenerationReferenceType,
  type GenerateVideosOperation,
  type VideoGenerationReferenceImage,
} from '@google/genai';
import type { AspectRatio, ImageInput } from './nanoBananaService';
import { arrayBufferToBase64 } from '../utils/image-utils';

export type VideoModel =
  | 'veo-3.1-generate-preview'
  | 'veo-3.1-fast-generate-preview'
  | 'veo-3.1-lite-generate-preview';

export type VideoAspectRatio = Extract<AspectRatio, '16:9' | '9:16'>;
export type VideoResolution = '720p' | '1080p' | '4k';
export type VideoDurationSeconds = 4 | 6 | 8;
export type VeoReferenceMode = 'text-to-video' | 'image-to-video' | 'first-last-frame' | 'reference-images';
type VeoImageInput = { imageBytes: string; mimeType: string };

export interface GenerateVideoOptions {
  prompt: string;
  model?: VideoModel;
  aspectRatio?: VideoAspectRatio;
  resolution?: VideoResolution;
  durationSeconds?: VideoDurationSeconds;
  sourceImages?: ImageInput[];
  styleImageCount?: number;
  referenceMode?: VeoReferenceMode;
  generateAudio?: boolean;
}

export interface VideoGenerationResult {
  videoData: string;
  videoMimeType: string;
  model: VideoModel;
  aspectRatio: VideoAspectRatio;
  resolution: VideoResolution;
  durationSeconds: VideoDurationSeconds;
  referenceMode: VeoReferenceMode;
  generateAudio: boolean;
}

interface GoogleVeoClient {
  models: {
    generateVideos(params: {
      model: string;
      prompt: string;
      image?: VeoImageInput;
      config?: {
        aspectRatio?: string;
        resolution?: string;
        durationSeconds?: number;
        numberOfVideos?: number;
        generateAudio?: boolean;
        lastFrame?: VeoImageInput;
        referenceImages?: VideoGenerationReferenceImage[];
      };
    }): Promise<GenerateVideosOperation>;
  };
  operations: {
    getVideosOperation(params: { operation: GenerateVideosOperation }): Promise<GenerateVideosOperation>;
  };
}

const DEFAULT_MODEL: VideoModel = 'veo-3.1-generate-preview';
const DEFAULT_ASPECT_RATIO: VideoAspectRatio = '16:9';
const DEFAULT_RESOLUTION: VideoResolution = '720p';
const DEFAULT_DURATION_SECONDS: VideoDurationSeconds = 8;
const POLL_INTERVAL_MS = 10_000;
const MAX_POLLS = 42; // Google documents peak latency up to roughly 6 minutes.

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeAspectRatio(value?: VideoAspectRatio): VideoAspectRatio {
  return value === '9:16' ? '9:16' : DEFAULT_ASPECT_RATIO;
}

function normalizeDuration(value?: VideoDurationSeconds, hasReferenceImages = false): VideoDurationSeconds {
  if (hasReferenceImages) return 8;
  if (value === 4 || value === 6 || value === 8) return value;
  return DEFAULT_DURATION_SECONDS;
}

function normalizeResolution(value?: VideoResolution): VideoResolution {
  if (value === '1080p' || value === '4k') return value;
  return DEFAULT_RESOLUTION;
}

function getReferenceType(index: number, styleImageCount: number): VideoGenerationReferenceType {
  return index < styleImageCount ? VideoGenerationReferenceType.STYLE : VideoGenerationReferenceType.ASSET;
}

export function determineVeoReferenceMode(sourceImageCount: number, styleImageCount = 0): VeoReferenceMode {
  if (sourceImageCount <= 0) return 'text-to-video';
  if (styleImageCount > 0) return 'reference-images';
  if (sourceImageCount === 1) return 'image-to-video';
  if (sourceImageCount === 2) return 'first-last-frame';
  return 'reference-images';
}

function normalizeVeoReferenceMode(
  requestedMode: VeoReferenceMode | undefined,
  sourceImageCount: number,
  styleImageCount: number
): VeoReferenceMode {
  const inferredMode = determineVeoReferenceMode(sourceImageCount, styleImageCount);
  if (!requestedMode || requestedMode === inferredMode) {
    return inferredMode;
  }

  return inferredMode;
}

function toGoogleImage(image: ImageInput): VeoImageInput {
  return {
    imageBytes: image.data,
    mimeType: image.mimeType,
  };
}

export class GoogleVeoService {
  private readonly ai: GoogleVeoClient;
  private readonly apiKey: string;

  constructor(apiKey: string, client?: GoogleVeoClient) {
    if (!apiKey && !client) {
      throw new Error('Google AI API key is required');
    }
    this.apiKey = apiKey;
    this.ai = client ?? new GoogleGenAI({ apiKey });
  }

  async generate(options: GenerateVideoOptions): Promise<VideoGenerationResult> {
    const { prompt, model = DEFAULT_MODEL } = options;
    if (!prompt) {
      throw new Error('Prompt is required');
    }

    const sourceImages = options.sourceImages ?? [];
    if (sourceImages.length > 3) {
      throw new Error('Veo video generation supports at most 3 reference images');
    }

    const aspectRatio = normalizeAspectRatio(options.aspectRatio);
    const resolution = normalizeResolution(options.resolution);
    const durationSeconds = normalizeDuration(options.durationSeconds, sourceImages.length > 0 || resolution !== '720p');
    const styleImageCount = Math.max(0, Math.min(options.styleImageCount ?? 0, sourceImages.length));
    const referenceMode = normalizeVeoReferenceMode(options.referenceMode, sourceImages.length, styleImageCount);
    const generateAudio = options.generateAudio === true;

    const config: {
      aspectRatio: string;
      resolution: string;
      durationSeconds: number;
      numberOfVideos: number;
      generateAudio: boolean;
      lastFrame?: VeoImageInput;
      referenceImages?: VideoGenerationReferenceImage[];
    } = {
      aspectRatio,
      resolution,
      durationSeconds,
      numberOfVideos: 1,
      generateAudio,
    };

    const request: Parameters<GoogleVeoClient['models']['generateVideos']>[0] = {
      model,
      prompt,
      config,
    };

    if (referenceMode === 'image-to-video') {
      request.image = toGoogleImage(sourceImages[0]);
    } else if (referenceMode === 'first-last-frame') {
      request.image = toGoogleImage(sourceImages[0]);
      config.lastFrame = toGoogleImage(sourceImages[1]);
    } else if (sourceImages.length > 0) {
      config.referenceImages = sourceImages.map((image, index) => ({
        image: toGoogleImage(image),
        referenceType: getReferenceType(index, styleImageCount),
      }));
    }

    let operation = await this.ai.models.generateVideos(request);
    for (let poll = 0; !operation.done && poll < MAX_POLLS; poll++) {
      await delay(POLL_INTERVAL_MS);
      operation = await this.ai.operations.getVideosOperation({ operation });
    }

    if (!operation.done) {
      throw new Error('Veo video generation timed out');
    }
    if (operation.error) {
      const message = typeof operation.error.message === 'string'
        ? operation.error.message
        : JSON.stringify(operation.error);
      throw new Error(`Veo video generation failed: ${message}`);
    }

    const response = operation.response;
    if (response?.raiMediaFilteredCount && response.raiMediaFilteredCount > 0) {
      const reasons = response.raiMediaFilteredReasons?.join(', ');
      throw new Error(`Veo video generation blocked by safety filters${reasons ? `: ${reasons}` : ''}`);
    }

    const video = response?.generatedVideos?.[0]?.video;
    if (!video?.videoBytes && !video?.uri) {
      throw new Error('No video generated');
    }

    const downloaded = video.videoBytes
      ? { videoData: video.videoBytes, videoMimeType: video.mimeType ?? 'video/mp4' }
      : await this.downloadGeneratedVideo(video.uri!, video.mimeType);

    return {
      videoData: downloaded.videoData,
      videoMimeType: downloaded.videoMimeType,
      model,
      aspectRatio,
      resolution,
      durationSeconds,
      referenceMode,
      generateAudio,
    };
  }

  private async downloadGeneratedVideo(
    uri: string,
    fallbackMimeType?: string
  ): Promise<{ videoData: string; videoMimeType: string }> {
    const headers = new Headers();
    if (this.apiKey) {
      headers.set('x-goog-api-key', this.apiKey);
    }

    const response = await fetch(uri, { headers, redirect: 'follow' });
    if (!response.ok) {
      throw new Error(`Failed to download generated video (${response.status})`);
    }

    const buffer = await response.arrayBuffer();
    return {
      videoData: arrayBufferToBase64(buffer),
      videoMimeType: response.headers.get('Content-Type') ?? fallbackMimeType ?? 'video/mp4',
    };
  }
}
