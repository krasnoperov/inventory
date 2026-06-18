export type VideoGenerationResolution = '720p' | '1080p' | '4k';
export type VideoGenerationDurationSeconds = 4 | 6 | 8;
export type VideoGenerationTier = 'generate' | 'fast' | 'lite';
export type VideoGenerationModel =
  | 'veo-3.1-generate-preview'
  | 'veo-3.1-fast-generate-preview'
  | 'veo-3.1-lite-generate-preview';

export const VIDEO_GENERATION_RESOLUTIONS: VideoGenerationResolution[] = ['720p', '1080p', '4k'];
export const VIDEO_GENERATION_DURATION_SECONDS: VideoGenerationDurationSeconds[] = [4, 6, 8];
export const VIDEO_GENERATION_TIERS: VideoGenerationTier[] = ['generate', 'fast', 'lite'];

export const DEFAULT_VIDEO_GENERATION_RESOLUTION: VideoGenerationResolution = '720p';
export const DEFAULT_VIDEO_GENERATION_DURATION_SECONDS: VideoGenerationDurationSeconds = 8;
export const DEFAULT_VIDEO_GENERATION_TIER: VideoGenerationTier = 'generate';
export const DEFAULT_VIDEO_GENERATION_MODEL: VideoGenerationModel = 'veo-3.1-generate-preview';

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

export function getVideoGenerationTierForModel(
  model: unknown
): VideoGenerationTier | undefined {
  if (typeof model !== 'string') return undefined;
  return VIDEO_GENERATION_TIERS.find((tier) => VIDEO_GENERATION_TIER_MODELS[tier] === model);
}
