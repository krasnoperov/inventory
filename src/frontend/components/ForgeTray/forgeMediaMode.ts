import type { MediaKind } from '../../../shared/websocket-types';

export type ForgeMediaMode = 'image' | 'video' | 'speech' | 'dialogue' | 'music' | 'sfx';

export interface ForgeMediaModeConfig {
  mode: ForgeMediaMode;
  label: string;
  shortLabel: string;
  mediaKind: MediaKind;
  assetType: string;
  promptNoun: string;
}

export const FORGE_MEDIA_MODE_CONFIGS: ForgeMediaModeConfig[] = [
  {
    mode: 'image',
    label: 'Image',
    shortLabel: 'Image',
    mediaKind: 'image',
    assetType: 'character',
    promptNoun: 'asset',
  },
  {
    mode: 'video',
    label: 'Video',
    shortLabel: 'Video',
    mediaKind: 'video',
    assetType: 'animation',
    promptNoun: 'video',
  },
  {
    mode: 'speech',
    label: 'Speech',
    shortLabel: 'Speech',
    mediaKind: 'audio',
    assetType: 'speech',
    promptNoun: 'speech clip',
  },
  {
    mode: 'dialogue',
    label: 'Dialogue',
    shortLabel: 'Dialogue',
    mediaKind: 'audio',
    assetType: 'dialogue',
    promptNoun: 'dialogue clip',
  },
  {
    mode: 'music',
    label: 'Music',
    shortLabel: 'Music',
    mediaKind: 'audio',
    assetType: 'music',
    promptNoun: 'music cue',
  },
  {
    mode: 'sfx',
    label: 'SFX',
    shortLabel: 'SFX',
    mediaKind: 'audio',
    assetType: 'sfx',
    promptNoun: 'sound effect',
  },
];

const CONFIG_BY_MODE = new Map(FORGE_MEDIA_MODE_CONFIGS.map((config) => [config.mode, config]));

export function getForgeMediaModeConfig(mode: ForgeMediaMode): ForgeMediaModeConfig {
  return CONFIG_BY_MODE.get(mode) ?? FORGE_MEDIA_MODE_CONFIGS[0];
}

export function getMediaKindForForgeMode(mode: ForgeMediaMode): MediaKind {
  return getForgeMediaModeConfig(mode).mediaKind;
}

export function isAudioForgeMode(mode: ForgeMediaMode): boolean {
  return getMediaKindForForgeMode(mode) === 'audio';
}

export function getAssetTypeForForgeMode(mode: ForgeMediaMode, inheritedType?: string): string {
  if (mode === 'image' || mode === 'video') {
    return inheritedType || getForgeMediaModeConfig(mode).assetType;
  }
  return getForgeMediaModeConfig(mode).assetType;
}

export function getForgeModeForAudioAssetType(assetType?: string | null): ForgeMediaMode {
  switch (assetType) {
    case 'speech':
    case 'dialogue':
    case 'music':
    case 'sfx':
      return assetType;
    default:
      return 'speech';
  }
}
