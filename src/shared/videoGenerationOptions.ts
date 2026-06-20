import type { GenerateVideosConfig } from '@google/genai';

export type VideoGenerationAspectRatio = '16:9' | '9:16';
export type VideoGenerationResolution = '720p' | '1080p' | '4k';
export type VideoGenerationDurationSeconds = 4 | 6 | 8;
export type VideoGenerationTier = 'generate' | 'fast' | 'lite';
export type VideoGenerationModel =
  | 'veo-3.1-generate-preview'
  | 'veo-3.1-fast-generate-preview'
  | 'veo-3.1-lite-generate-preview';

type GeminiVeoUiConfig = Pick<GenerateVideosConfig, 'aspectRatio' | 'resolution' | 'durationSeconds'>;
type AssertAssignable<_T extends U, U> = true;
export type VideoAspectRatioApiContract = AssertAssignable<
  VideoGenerationAspectRatio,
  NonNullable<GeminiVeoUiConfig['aspectRatio']>
>;
export type VideoResolutionApiContract = AssertAssignable<
  VideoGenerationResolution,
  NonNullable<GeminiVeoUiConfig['resolution']>
>;
export type VideoDurationApiContract = AssertAssignable<
  VideoGenerationDurationSeconds,
  NonNullable<GeminiVeoUiConfig['durationSeconds']>
>;

export const VIDEO_GENERATION_ASPECT_RATIOS: VideoGenerationAspectRatio[] = ['16:9', '9:16'];
export const VIDEO_GENERATION_RESOLUTIONS: VideoGenerationResolution[] = ['720p', '1080p', '4k'];
export const VIDEO_GENERATION_DURATION_SECONDS: VideoGenerationDurationSeconds[] = [4, 6, 8];
export const VIDEO_GENERATION_TIERS: VideoGenerationTier[] = ['generate', 'fast', 'lite'];
export const DEFAULT_VIDEO_GENERATION_GENERATE_AUDIO = true;
export const VIDEO_GENERATION_AUDIO_ALWAYS_ON = DEFAULT_VIDEO_GENERATION_GENERATE_AUDIO;
export const VIDEO_GENERATION_AUDIO_TOGGLE_MODELS: VideoGenerationModel[] = [];
export const VIDEO_GENERATION_RESOLUTIONS_BY_TIER: Record<VideoGenerationTier, VideoGenerationResolution[]> = {
  generate: VIDEO_GENERATION_RESOLUTIONS,
  fast: VIDEO_GENERATION_RESOLUTIONS,
  lite: ['720p', '1080p'],
};

export const DEFAULT_VIDEO_GENERATION_RESOLUTION: VideoGenerationResolution = '720p';
export const DEFAULT_VIDEO_GENERATION_DURATION_SECONDS: VideoGenerationDurationSeconds = 8;
export const DEFAULT_VIDEO_GENERATION_TIER: VideoGenerationTier = 'generate';
export const DEFAULT_VIDEO_GENERATION_MODEL: VideoGenerationModel = 'veo-3.1-generate-preview';

export function normalizeVideoGenerationAspectRatio(
  value: unknown
): VideoGenerationAspectRatio | undefined {
  return VIDEO_GENERATION_ASPECT_RATIOS.includes(value as VideoGenerationAspectRatio)
    ? value as VideoGenerationAspectRatio
    : undefined;
}

export const VIDEO_GENERATION_TIER_MODELS: Record<VideoGenerationTier, VideoGenerationModel> = {
  generate: 'veo-3.1-generate-preview',
  fast: 'veo-3.1-fast-generate-preview',
  lite: 'veo-3.1-lite-generate-preview',
};

export function normalizeVideoGenerationResolution(
  value: unknown
): VideoGenerationResolution | undefined {
  return VIDEO_GENERATION_RESOLUTIONS.includes(value as VideoGenerationResolution)
    ? value as VideoGenerationResolution
    : undefined;
}

export function normalizeVideoGenerationDurationSeconds(
  value: unknown
): VideoGenerationDurationSeconds | undefined {
  const numeric = typeof value === 'string' ? Number(value) : value;
  return VIDEO_GENERATION_DURATION_SECONDS.includes(numeric as VideoGenerationDurationSeconds)
    ? numeric as VideoGenerationDurationSeconds
    : undefined;
}

export function normalizeVideoGenerationTier(value: unknown): VideoGenerationTier | undefined {
  return VIDEO_GENERATION_TIERS.includes(value as VideoGenerationTier)
    ? value as VideoGenerationTier
    : undefined;
}

export function getVideoGenerationModelForTier(
  tier: VideoGenerationTier = DEFAULT_VIDEO_GENERATION_TIER
): VideoGenerationModel {
  return VIDEO_GENERATION_TIER_MODELS[tier];
}

export function getVideoGenerationResolutionsForTier(
  tier: VideoGenerationTier = DEFAULT_VIDEO_GENERATION_TIER
): VideoGenerationResolution[] {
  return VIDEO_GENERATION_RESOLUTIONS_BY_TIER[tier];
}

export function isVideoGenerationResolutionSupportedForTier(
  resolution: VideoGenerationResolution,
  tier: VideoGenerationTier = DEFAULT_VIDEO_GENERATION_TIER
): boolean {
  return VIDEO_GENERATION_RESOLUTIONS_BY_TIER[tier].includes(resolution);
}

export function getVideoGenerationTierForModel(
  model: unknown
): VideoGenerationTier | undefined {
  if (typeof model !== 'string') return undefined;
  return VIDEO_GENERATION_TIERS.find((tier) => VIDEO_GENERATION_TIER_MODELS[tier] === model);
}

export function doesVideoGenerationModelSupportAudioToggle(model: VideoGenerationModel): boolean {
  return VIDEO_GENERATION_AUDIO_TOGGLE_MODELS.includes(model);
}
