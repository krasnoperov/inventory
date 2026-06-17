import type { ForgeOperation, MediaKind } from './websocket-types';

export type ForgeMediaMode = 'image' | 'video' | 'speech' | 'dialogue' | 'music' | 'sfx';
export type AudioForgeMediaMode = Extract<ForgeMediaMode, 'speech' | 'dialogue' | 'music' | 'sfx'>;
export type ForgeDestinationType = 'existing_asset' | 'new_asset';
export type MediaGenerationCommand = 'generate' | 'refine' | 'derive' | 'batch';
export type CliGenerationNamespace = 'top-level' | 'audio' | 'video';

export interface MediaOperationMatrixEntry {
  mode: ForgeMediaMode;
  label: string;
  shortLabel: string;
  mediaKind: MediaKind;
  assetType: string;
  promptNoun: string;
  inheritsReferenceAssetType: boolean;
  compatibleSlotMediaKinds: readonly MediaKind[];
  supportsBatch: boolean;
  supportsStyle: boolean;
  cliNamespace: CliGenerationNamespace | null;
  cliCommands: readonly MediaGenerationCommand[];
  cliSupportsRefs: boolean;
  cliSavesBatchManifest: boolean;
}

export interface CliGenerationProfile {
  namespace: CliGenerationNamespace;
  mediaKind: MediaKind;
  commands: readonly MediaGenerationCommand[];
  supportsRefs: boolean;
  savesBatchManifest: boolean;
}

export const MEDIA_OPERATION_MATRIX: readonly MediaOperationMatrixEntry[] = [
  {
    mode: 'image',
    label: 'Image',
    shortLabel: 'Image',
    mediaKind: 'image',
    assetType: 'character',
    promptNoun: 'asset',
    inheritsReferenceAssetType: true,
    compatibleSlotMediaKinds: ['image'],
    supportsBatch: true,
    supportsStyle: true,
    cliNamespace: 'top-level',
    cliCommands: ['generate', 'refine', 'derive', 'batch'],
    cliSupportsRefs: true,
    cliSavesBatchManifest: true,
  },
  {
    mode: 'video',
    label: 'Video',
    shortLabel: 'Video',
    mediaKind: 'video',
    assetType: 'animation',
    promptNoun: 'video',
    inheritsReferenceAssetType: true,
    compatibleSlotMediaKinds: ['image', 'video'],
    supportsBatch: false,
    supportsStyle: true,
    cliNamespace: 'video',
    cliCommands: ['generate', 'refine', 'derive'],
    cliSupportsRefs: true,
    cliSavesBatchManifest: false,
  },
  {
    mode: 'speech',
    label: 'Speech',
    shortLabel: 'Speech',
    mediaKind: 'audio',
    assetType: 'speech',
    promptNoun: 'speech clip',
    inheritsReferenceAssetType: false,
    compatibleSlotMediaKinds: ['audio'],
    supportsBatch: true,
    supportsStyle: false,
    cliNamespace: 'audio',
    cliCommands: ['generate', 'batch'],
    cliSupportsRefs: false,
    cliSavesBatchManifest: false,
  },
  {
    mode: 'dialogue',
    label: 'Dialogue',
    shortLabel: 'Dialogue',
    mediaKind: 'audio',
    assetType: 'dialogue',
    promptNoun: 'dialogue clip',
    inheritsReferenceAssetType: false,
    compatibleSlotMediaKinds: ['audio'],
    supportsBatch: true,
    supportsStyle: false,
    cliNamespace: 'audio',
    cliCommands: ['generate', 'batch'],
    cliSupportsRefs: false,
    cliSavesBatchManifest: false,
  },
  {
    mode: 'music',
    label: 'Music',
    shortLabel: 'Music',
    mediaKind: 'audio',
    assetType: 'music',
    promptNoun: 'music cue',
    inheritsReferenceAssetType: false,
    compatibleSlotMediaKinds: ['audio'],
    supportsBatch: true,
    supportsStyle: false,
    cliNamespace: 'audio',
    cliCommands: ['generate', 'batch'],
    cliSupportsRefs: false,
    cliSavesBatchManifest: false,
  },
  {
    mode: 'sfx',
    label: 'SFX',
    shortLabel: 'SFX',
    mediaKind: 'audio',
    assetType: 'sfx',
    promptNoun: 'sound effect',
    inheritsReferenceAssetType: false,
    compatibleSlotMediaKinds: ['audio'],
    supportsBatch: true,
    supportsStyle: false,
    cliNamespace: 'audio',
    cliCommands: ['generate', 'batch'],
    cliSupportsRefs: false,
    cliSavesBatchManifest: false,
  },
];

export const CLI_GENERATION_PROFILES: readonly CliGenerationProfile[] = [
  {
    namespace: 'top-level',
    mediaKind: 'image',
    commands: ['generate', 'refine', 'derive', 'batch'],
    supportsRefs: true,
    savesBatchManifest: true,
  },
  {
    namespace: 'audio',
    mediaKind: 'audio',
    commands: ['generate', 'batch'],
    supportsRefs: false,
    savesBatchManifest: false,
  },
  {
    namespace: 'video',
    mediaKind: 'video',
    commands: ['generate', 'refine', 'derive'],
    supportsRefs: true,
    savesBatchManifest: false,
  },
];

const ENTRY_BY_MODE = new Map(MEDIA_OPERATION_MATRIX.map((entry) => [entry.mode, entry]));
const PROFILE_BY_NAMESPACE = new Map(
  CLI_GENERATION_PROFILES.map((profile) => [profile.namespace, profile])
);

export const AUDIO_FORGE_MEDIA_MODES: readonly AudioForgeMediaMode[] = MEDIA_OPERATION_MATRIX
  .filter((entry): entry is MediaOperationMatrixEntry & { mode: AudioForgeMediaMode } => (
    entry.mediaKind === 'audio'
  ))
  .map((entry) => entry.mode);

export function getMediaOperationEntry(mode: ForgeMediaMode): MediaOperationMatrixEntry {
  return ENTRY_BY_MODE.get(mode) ?? MEDIA_OPERATION_MATRIX[0];
}

export function getMediaKindForForgeMode(mode: ForgeMediaMode): MediaKind {
  return getMediaOperationEntry(mode).mediaKind;
}

export function isAudioForgeMode(mode: ForgeMediaMode): boolean {
  return getMediaKindForForgeMode(mode) === 'audio';
}

export function isAudioForgeMediaMode(value: string | undefined): value is AudioForgeMediaMode {
  return AUDIO_FORGE_MEDIA_MODES.includes(value as AudioForgeMediaMode);
}

export function canUseSlotMediaKindForForgeMode(mode: ForgeMediaMode, slotMediaKind: MediaKind): boolean {
  return getMediaOperationEntry(mode).compatibleSlotMediaKinds.includes(slotMediaKind);
}

export function getAssetTypeForForgeMode(mode: ForgeMediaMode, inheritedType?: string): string {
  const entry = getMediaOperationEntry(mode);
  if (entry.inheritsReferenceAssetType && inheritedType) {
    return inheritedType;
  }
  return entry.assetType;
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

export function getForgeOperationForState(
  slotCount: number,
  hasPrompt: boolean,
  destinationType: ForgeDestinationType
): ForgeOperation {
  if (slotCount === 0) {
    return destinationType === 'existing_asset' ? 'refine' : 'generate';
  }
  if (slotCount === 1 && !hasPrompt && destinationType === 'new_asset') {
    return 'fork';
  }
  return destinationType === 'existing_asset' ? 'refine' : 'derive';
}

export function getCliGenerationProfile(namespace: CliGenerationNamespace): CliGenerationProfile {
  const profile = PROFILE_BY_NAMESPACE.get(namespace);
  if (!profile) {
    throw new Error(`Unknown CLI generation namespace: ${namespace}`);
  }
  return profile;
}

export function getCliGenerationMediaKind(
  namespace: CliGenerationNamespace
): CliGenerationProfile['mediaKind'] {
  return getCliGenerationProfile(namespace).mediaKind;
}

export function getCliGenerationCommands(
  namespace: CliGenerationNamespace
): readonly MediaGenerationCommand[] {
  return getCliGenerationProfile(namespace).commands;
}

export function cliGenerationSupportsRefs(namespace: CliGenerationNamespace): boolean {
  return getCliGenerationProfile(namespace).supportsRefs;
}
