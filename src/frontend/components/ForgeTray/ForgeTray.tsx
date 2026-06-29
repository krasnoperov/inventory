import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import type { ReactNode } from 'react';
import { useForgeTrayStore } from '../../stores/forgeTrayStore';
import type { ForgeOperation } from '../../stores/forgeTrayStore';
import {
  type Asset,
  type CollectionItem,
  type SpaceCollection,
  type Variant,
  type ChatMessageClient,
  type ChatForgeContext,
  type ForgeChatProgressResult,
  type GenerationEstimateRequestParams,
  type GenerationEstimateResult,
  type StylePresetCreateParams,
  type StylePresetRaw,
  type StylePresetUpdateParams,
} from '../../hooks/useSpaceWebSocket';
import type { MediaKind, MusicGenerationProvider } from '../../../shared/websocket-types';
import {
  IMAGE_ASPECT_RATIOS,
  IMAGE_MODEL_SELECTIONS,
  IMAGE_SIZES,
  getImageModelCapabilities,
  getImageModelMaxReferenceImages,
  isImageSizeSupportedByModel,
  type ImageAspectRatio,
  type ImageModelSelection,
  type ImageSize,
} from '../../../shared/imageGenerationOptions';
import {
  DEFAULT_VIDEO_GENERATION_DURATION_SECONDS,
  DEFAULT_VIDEO_GENERATION_RESOLUTION,
  DEFAULT_VIDEO_GENERATION_TIER,
  VIDEO_GENERATION_AUDIO_ALWAYS_ON,
  VIDEO_GENERATION_DURATION_SECONDS,
  VIDEO_GENERATION_RESOLUTIONS,
  VIDEO_GENERATION_TIERS,
  getVideoGenerationResolutionsForTier,
  isVideoGenerationResolutionSupportedForTier,
  type VideoGenerationDurationSeconds,
  type VideoGenerationResolution,
  type VideoGenerationTier,
} from '../../../shared/videoGenerationOptions';
import { AssetPickerModal } from './AssetPickerModal';
import { ForgeChat } from './ForgeChat';
import { StylePanel } from './StylePanel';
import { VoicePicker } from './VoicePicker';
import { Thumbnail } from '../Thumbnail';
import { Link } from '../Link';
import { Button, IconButton, TextInput, UiSelect, type SelectOption } from '../../ui';
import {
  FORGE_MEDIA_MODE_CONFIGS,
  canUseSlotMediaKindForForgeMode,
  type ForgeMediaMode,
  getAssetTypeForForgeMode,
  getForgeMediaModeConfig,
  getForgeOperationForState,
  getForgeModeForAudioAssetType,
  getMediaKindForForgeMode,
  isAudioForgeMode,
} from './forgeMediaMode';
import styles from './ForgeTray.module.css';

export type DestinationType = 'existing_asset' | 'new_asset';

const MAX_VIDEO_REFERENCE_SLOTS = 3;

export interface ForgeSubmitParams {
  prompt?: string;  // undefined for fork (copy without modification)
  /** Media kind requested by the selected Forge Tray mode */
  mediaKind?: MediaKind;
  // Use referenceVariantIds for explicit variant selection (ForgeTray UI)
  // Use referenceAssetIds for asset-level references (Chat/Claude) - backend resolves to default variants
  referenceVariantIds?: string[];
  referenceAssetIds?: string[];
  destination: {
    type: DestinationType;
    assetId?: string;
    assetName?: string;
    assetType?: string;
  };
  operation: ForgeOperation;
  /** Number of batch variants to generate (2-8) */
  batchCount?: number;
  /** Batch mode: 'explore' = 1 asset N variants, 'set' = N assets */
  batchMode?: 'explore' | 'set';
  /** Image generation model */
  model?: ImageModelSelection;
  /** Aspect ratio for generation */
  aspectRatio?: ImageAspectRatio;
  /** Image output size */
  imageSize?: ImageSize;
  /** Disable style anchoring for this generation */
  disableStyle?: boolean;
  /** Named style preset for this request */
  stylePresetId?: string;
  /** Exact style variants selected for this request */
  styleVariantIds?: string[];
  /** ElevenLabs speech voice ID (speech mode) */
  voiceId?: string;
  /** ElevenLabs dialogue voice IDs, ordered by speaker (dialogue mode) */
  dialogueVoiceIds?: string[];
  /** Music provider selection (music mode only) */
  musicProvider?: MusicGenerationProvider;
  /** Veo output resolution (video mode) */
  videoResolution?: VideoGenerationResolution;
  /** Veo output duration in seconds (video mode) */
  videoDurationSeconds?: VideoGenerationDurationSeconds;
  /** Veo model tier (video mode) */
  videoTier?: VideoGenerationTier;
}

export interface ForgeTrayProps {
  allAssets: Asset[];
  allVariants: Variant[];
  onSubmit: (params: ForgeSubmitParams) => void | string;
  onBrandBackground?: boolean;
  /** Current asset context (for Asset Detail page) */
  currentAsset?: Asset | null;
  /** Compact context shown above the prompt/options area. */
  contextSlot?: ReactNode;
  /** Disable fixed positioning when the page owns the surrounding dock. */
  floating?: boolean;
  /** Callback for uploading a media file to create a variant on existing asset */
  onUpload?: (file: File, assetId: string) => Promise<void>;
  /** Callback for uploading a media file to create a NEW asset (SpacePage) */
  onUploadNewAsset?: (file: File, assetName: string) => Promise<void>;
  /** Whether an upload is in progress */
  isUploading?: boolean;
  /** Persistent chat messages */
  chatMessages?: ChatMessageClient[];
  /** Whether a chat request is in progress */
  isChatLoading?: boolean;
  /** Last chat progress update (description phase) */
  chatProgress?: ForgeChatProgressResult | null;
  /** Chat error message */
  chatError?: string | null;
  /** Whether chat history has been loaded for current space */
  chatHistoryLoaded?: boolean;
  /** Handler to send persistent chat message */
  sendChatMessage?: (content: string, forgeContext?: ChatForgeContext) => void;
  /** Handler to request chat history */
  requestChatHistory?: () => void;
  /** Handler to clear chat session */
  clearChatSession?: () => void;
  /** Space ID for style panel */
  spaceId?: string;
  /** Asset-backed style methods */
  createStylePreset?: (params: StylePresetCreateParams) => void;
  updateStylePreset?: (presetId: string, changes: StylePresetUpdateParams) => void;
  deleteStylePreset?: (presetId: string) => void;
  stylePresets?: StylePresetRaw[];
  collections?: SpaceCollection[];
  collectionItems?: CollectionItem[];
  /** Batch send function */
  sendBatchRequest?: (params: import('../../hooks/useSpaceWebSocket').BatchRequestParams) => string;
  /** Forge error (generate/refine/batch failure) */
  forgeError?: string | null;
  /** Forge error code for programmatic handling */
  forgeErrorCode?: string | null;
  /** Latest generation usage/cost estimate response from the Space WebSocket */
  generationEstimate?: GenerationEstimateResult | null;
  /** Request a preflight usage/cost estimate for the current Forge Tray state */
  sendGenerationEstimateRequest?: (params: GenerationEstimateRequestParams) => string;
}

const ACCEPTED_UPLOAD_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'audio/aac',
  'audio/flac',
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'audio/x-wav',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-m4v',
];

const ACCEPTED_UPLOAD_TYPES = ACCEPTED_UPLOAD_MIME_TYPES.join(',');

/**
 * Top-level media group. The tray surfaces these three primary modes; audio
 * expands into its specific sub-modes (speech / dialogue / music / sfx) only
 * once selected, keeping the default control surface small.
 */
type MediaGroup = 'image' | 'video' | 'audio';

const MEDIA_GROUP_OPTIONS: { group: MediaGroup; label: string }[] = [
  { group: 'image', label: 'Image' },
  { group: 'video', label: 'Video' },
  { group: 'audio', label: 'Audio' },
];

const MEDIA_GROUP_SELECT_OPTIONS: Array<SelectOption<MediaGroup>> = MEDIA_GROUP_OPTIONS.map((option) => ({
  value: option.group,
  label: option.label,
}));

const MEDIA_GROUP_LABEL: Record<MediaGroup, string> = {
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
};

const AUDIO_MODE_CONFIGS = FORGE_MEDIA_MODE_CONFIGS.filter((config) => isAudioForgeMode(config.mode));
const MUSIC_PROVIDER_OPTIONS: Array<{ value: MusicGenerationProvider; label: string }> = [
  { value: 'elevenlabs', label: 'ElevenLabs' },
  { value: 'lyria', label: 'Lyria' },
];

const MUSIC_PROVIDER_SELECT_OPTIONS: Array<SelectOption<MusicGenerationProvider>> = MUSIC_PROVIDER_OPTIONS.map((option) => ({
  value: option.value,
  label: option.label,
}));

const VIDEO_TIER_LABELS: Record<VideoGenerationTier, string> = {
  generate: 'Generate',
  fast: 'Fast',
  lite: 'Lite',
};

const IMAGE_MODEL_SELECT_OPTIONS: Array<SelectOption<ImageModelSelection>> = IMAGE_MODEL_SELECTIONS.map((model) => ({
  value: model,
  label: model === 'pro' ? 'Pro' : 'Flash',
}));

const IMAGE_ASPECT_RATIO_SELECT_OPTIONS: Array<SelectOption<ImageAspectRatio>> = IMAGE_ASPECT_RATIOS.map((ratio) => ({
  value: ratio,
  label: ratio,
}));

const VIDEO_TIER_SELECT_OPTIONS: Array<SelectOption<VideoGenerationTier>> = VIDEO_GENERATION_TIERS.map((tier) => ({
  value: tier,
  label: VIDEO_TIER_LABELS[tier],
}));

type StyleSelection =
  | { mode: 'default' }
  | { mode: 'preset'; presetId: string }
  | { mode: 'none' }
  | { mode: 'custom'; variantIds: string[] };

const ESTIMATE_METER_LABELS: Record<string, string> = {
  gemini_images: 'Gemini image',
  gemini_videos: 'Veo video unit',
  gemini_audio: 'Lyria generation',
  elevenlabs_audio: 'ElevenLabs unit',
};

function getMediaGroup(mode: ForgeMediaMode): MediaGroup {
  if (mode === 'image') return 'image';
  if (mode === 'video') return 'video';
  return 'audio';
}

// Get button label for operation
function getOperationLabel(operation: ForgeOperation, mediaMode: ForgeMediaMode): string {
  const modeConfig = getForgeMediaModeConfig(mediaMode);
  const mediaSuffix = mediaMode === 'image' ? '' : ` ${modeConfig.shortLabel}`;
  switch (operation) {
    case 'generate': return `Generate${mediaSuffix}`;
    case 'fork': return `Fork${mediaSuffix}`;
    case 'derive': return `Derive${mediaSuffix}`;
    case 'refine': return `Refine${mediaSuffix}`;
  }
}

// Get placeholder text based on state
function getPlaceholder(slotCount: number, operation: ForgeOperation, mediaMode: ForgeMediaMode): string {
  const noun = getForgeMediaModeConfig(mediaMode).promptNoun;
  if (slotCount === 0 && operation === 'refine') return `Describe a new ${noun} variant…`;
  if (slotCount === 0) return `Describe the ${noun} you want to create…`;
  if (operation === 'fork') return 'Leave empty to fork, or describe changes…';
  if (operation === 'derive') return `Describe the ${noun} to derive from these references…`;
  return `Describe the ${noun} refinement or transformation…`;
}

function formatMediaKindList(mediaKinds: readonly MediaKind[]): string {
  if (mediaKinds.length <= 1) return mediaKinds[0] ?? 'media';
  return `${mediaKinds.slice(0, -1).join(', ')} or ${mediaKinds[mediaKinds.length - 1]}`;
}

function formatEstimatedUsd(microUsd: number): string {
  if (!Number.isFinite(microUsd) || microUsd <= 0) return '$0.00';
  if (microUsd < 10_000) return '<$0.01';
  return `$${(microUsd / 1_000_000).toFixed(2)}`;
}

function formatEstimateQuantity(quantity: number, singular: string): string {
  const normalized = Number.isFinite(quantity) ? quantity : 0;
  const suffix = normalized === 1 ? singular : `${singular}s`;
  return `${normalized.toLocaleString()} ${suffix}`;
}

function isVeoImageInput(slot: { variant: Variant }): boolean {
  return slot.variant.media_kind === 'image' || Boolean(slot.variant.image_key);
}

function isEnabledPreset(preset: StylePresetRaw): boolean {
  return preset.enabled === true || preset.enabled === 1;
}

function isDefaultPreset(preset: StylePresetRaw): boolean {
  return preset.is_default === true || preset.is_default === 1;
}

function getCollectionStyleVariantIds(
  collectionId: string,
  collectionItems: CollectionItem[],
  allAssets: Asset[],
  allVariants: Variant[],
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of collectionItems) {
    if (item.collection_id !== collectionId || item.role !== 'style_ref') continue;
    let variantId = item.variant_id ?? item.pinned_variant_id ?? null;
    if (!variantId && item.asset_id) {
      const asset = allAssets.find((candidate) => candidate.id === item.asset_id);
      variantId = asset?.active_variant_id ?? null;
    }
    const variant = variantId ? allVariants.find((candidate) => candidate.id === variantId) : null;
    if (!variant || variant.status !== 'completed' || !variant.image_key || seen.has(variant.id)) continue;
    seen.add(variant.id);
    ids.push(variant.id);
  }
  return ids;
}

export function ForgeTray({
  allAssets,
  allVariants,
  onSubmit,
  onBrandBackground = true,
  currentAsset,
  contextSlot,
  floating = true,
  onUpload,
  onUploadNewAsset,
  isUploading = false,
  chatMessages = [],
  isChatLoading = false,
  chatProgress,
  chatError,
  chatHistoryLoaded = false,
  sendChatMessage,
  requestChatHistory,
  clearChatSession,
  spaceId,
  createStylePreset,
  updateStylePreset,
  deleteStylePreset,
  stylePresets = [],
  forgeError,
  forgeErrorCode,
  generationEstimate,
  sendGenerationEstimateRequest,
  collections = [],
  collectionItems = [],
}: ForgeTrayProps) {
  const { slots, prompt, setPrompt, clearSlots, removeSlot, setMaxSlots, prefillAudio, prefillToken } = useForgeTrayStore();
  const [showAssetPicker, setShowAssetPicker] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showUploadPrompt, setShowUploadPrompt] = useState(false);
  const [uploadAssetName, setUploadAssetName] = useState('');
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null);
  const [showChat, setShowChat] = useState(false);
  // Tray rests as a compact prompt + control bar; the per-mode options reveal
  // once the user engages the tray (focus, a draft prompt, references, or an
  // open panel).
  const [trayFocused, setTrayFocused] = useState(false);
  const [showStylePanel, setShowStylePanel] = useState(false);
  const [styleSelection, setStyleSelection] = useState<StyleSelection>({ mode: 'default' });
  const [batchCount, setBatchCount] = useState(1);
  const [batchMode, setBatchMode] = useState<'explore' | 'set'>('explore');
  const [activeEstimate, setActiveEstimate] = useState<GenerationEstimateResult | null>(null);
  const [estimateLoading, setEstimateLoading] = useState(false);
  const [imageModel, setImageModel] = useState<ImageModelSelection>('pro');
  const [imageSize, setImageSize] = useState<ImageSize>('1K');
  const imageModelCapabilities = getImageModelCapabilities(imageModel);
  const [aspectRatio, setAspectRatio] = useState<ImageAspectRatio>('1:1');
  const [mediaMode, setMediaMode] = useState<ForgeMediaMode>('image');
  // Remembers the last selected audio sub-mode so re-opening the Audio group
  // restores the user's previous choice instead of always resetting to speech.
  const [lastAudioMode, setLastAudioMode] = useState<ForgeMediaMode>('speech');
  const [voiceId, setVoiceId] = useState<string | undefined>(undefined);
  const [dialogueVoiceIds, setDialogueVoiceIds] = useState<string[]>([]);
  const [musicProvider, setMusicProvider] = useState<MusicGenerationProvider>('elevenlabs');
  const [musicProviderExplicit, setMusicProviderExplicit] = useState(false);
  const [videoResolution, setVideoResolution] = useState<VideoGenerationResolution>(DEFAULT_VIDEO_GENERATION_RESOLUTION);
  const [videoDurationSeconds, setVideoDurationSeconds] = useState<VideoGenerationDurationSeconds>(DEFAULT_VIDEO_GENERATION_DURATION_SECONDS);
  const [videoTier, setVideoTier] = useState<VideoGenerationTier>(DEFAULT_VIDEO_GENERATION_TIER);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const estimateRequestIdRef = useRef<string | null>(null);

  const handleVideoTierSelect = useCallback((tier: VideoGenerationTier) => {
    setVideoTier(tier);
    setVideoResolution((current) => {
      if (isVideoGenerationResolutionSupportedForTier(current, tier)) return current;
      const compatibleResolutions = getVideoGenerationResolutionsForTier(tier);
      return compatibleResolutions[compatibleResolutions.length - 1] ?? DEFAULT_VIDEO_GENERATION_RESOLUTION;
    });
  }, []);

  // Destination state
  const [destinationType, setDestinationType] = useState<DestinationType>('existing_asset');
  const currentDestinationRef = useRef<HTMLButtonElement>(null);
  const newDestinationRef = useRef<HTMLButtonElement>(null);
  // The asset name is auto-derived (Image N / Video N / Audio N). It only becomes
  // user-controlled once the user types into the (subtle) name field; until then
  // it tracks the auto default so switching media type relabels it.
  const [newAssetName, setNewAssetName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);

  // Target asset: currentAsset (Asset Detail) or first slot's asset (Scene)
  const targetAsset = useMemo(() => {
    if (currentAsset) return currentAsset;
    if (slots.length > 0) return slots[0].asset;
    return null;
  }, [currentAsset, slots]);
  const currentAssetId = currentAsset?.id;
  const currentAssetMediaKind = currentAsset?.media_kind;
  const currentAssetType = currentAsset?.type;

  // SpacePage (no currentAsset): always new_asset, no toggle
  // AssetDetailPage (has currentAsset): user can toggle between existing and new
  const effectiveDestinationType = useMemo(() => {
    if (!currentAsset) {
      return 'new_asset'; // SpacePage: always creates new assets
    }
    return destinationType;
  }, [currentAsset, destinationType]);

  useEffect(() => {
    if (currentAssetMediaKind === 'audio') {
      const audioMode = getForgeModeForAudioAssetType(currentAssetType);
      setMediaMode(audioMode);
      setLastAudioMode(audioMode);
    } else if (currentAssetMediaKind === 'video') {
      setMediaMode('video');
    } else if (currentAssetId) {
      setMediaMode('image');
    }
  }, [currentAssetId, currentAssetMediaKind, currentAssetType]);

  useEffect(() => {
    if (currentAsset || mediaMode !== 'image') {
      return;
    }
    const firstSlotMediaKind = slots[0]?.variant.media_kind;
    if (firstSlotMediaKind === 'audio') {
      const audioMode = getForgeModeForAudioAssetType(slots[0].asset.type);
      setMediaMode(audioMode);
      setLastAudioMode(audioMode);
    } else if (firstSlotMediaKind === 'video') {
      setMediaMode('video');
    }
  }, [currentAsset, mediaMode, slots]);

  // Apply audio params staged by a retry (prefillFromVariant) so regeneration
  // reuses the original voices instead of the picker's auto-seeded default.
  // Keyed on prefillToken so it runs once per retry and never clobbers the
  // user's own later edits. Token 0 is the initial state — nothing to apply.
  //
  // When prefillAudio is present (an audio retry) we *fully reset* the audio
  // state from the recipe rather than only applying defined fields: a recipe
  // that lacks a stored voice (e.g. older variants) must clear any stale tray
  // selection back to the deterministic picker default, not silently inherit a
  // leftover voice from a previous, unrelated generation.
  const appliedPrefillTokenRef = useRef(0);
  useEffect(() => {
    if (prefillToken === appliedPrefillTokenRef.current) return;
    appliedPrefillTokenRef.current = prefillToken;
    if (!prefillAudio) return;
    // undefined → clears the selection so VoicePicker re-seeds the first voice.
    setVoiceId(prefillAudio.voiceId);
    setDialogueVoiceIds(prefillAudio.dialogueVoiceIds ?? []);
    // Music has a real default + explicit flag; absence means "fall back to default".
    setMusicProvider(prefillAudio.musicProvider ?? 'elevenlabs');
    setMusicProviderExplicit(prefillAudio.musicProvider !== undefined);
  }, [prefillToken, prefillAudio]);

  const mediaModeConfig = getForgeMediaModeConfig(mediaMode);
  const selectedMediaKind = getMediaKindForForgeMode(mediaMode);
  const isAudioMode = isAudioForgeMode(mediaMode);
  const currentMediaGroup = getMediaGroup(mediaMode);
  // Voice selection only applies to spoken audio (speech/dialogue), not music/sfx.
  const showVoicePicker = mediaMode === 'speech' || mediaMode === 'dialogue';
  const incompatibleMediaSlots = slots.filter(
    (slot) => !canUseSlotMediaKindForForgeMode(mediaMode, slot.variant.media_kind)
  );
  const hasIncompatibleMediaSlots = incompatibleMediaSlots.length > 0;
  const canUseExistingDestination = !targetAsset || targetAsset.media_kind === selectedMediaKind;

  useEffect(() => {
    if (currentAsset && destinationType === 'existing_asset' && !canUseExistingDestination) {
      setDestinationType('new_asset');
    }
  }, [canUseExistingDestination, currentAsset, destinationType]);

  const hasPrompt = prompt.trim().length > 0;
  const operation = getForgeOperationForState(slots.length, hasPrompt, effectiveDestinationType);

  // Dynamic reference budget mirrors provider limits and reserves active style images.
  const enabledStylePresets = useMemo(
    () => stylePresets.filter(isEnabledPreset),
    [stylePresets],
  );
  const defaultStylePreset = useMemo(
    () => enabledStylePresets.find(isDefaultPreset) ?? null,
    [enabledStylePresets],
  );
  const styleVariantIds = useMemo(
    () => (styleSelection.mode === 'custom' ? styleSelection.variantIds : []),
    [styleSelection],
  );
  const selectedStylePreset = styleSelection.mode === 'preset'
    ? enabledStylePresets.find((preset) => preset.id === styleSelection.presetId) ?? null
    : styleSelection.mode === 'default'
      ? defaultStylePreset
      : null;
  const styleOverride = styleSelection.mode === 'none';
  const selectedStyleCount = styleSelection.mode === 'custom'
    ? styleVariantIds.length
    : selectedStylePreset?.reference_count ?? 0;
  const styleImageCount = mediaModeConfig.supportsStyle && !styleOverride ? selectedStyleCount : 0;
  const referenceSlotLimit = currentMediaGroup === 'image'
    ? getImageModelMaxReferenceImages(imageModel)
    : currentMediaGroup === 'video'
      ? MAX_VIDEO_REFERENCE_SLOTS
      : 14;
  const providerReferenceSlots = Math.max(0, referenceSlotLimit - styleImageCount);
  const forkSetupSlots = effectiveDestinationType === 'new_asset' && !hasPrompt ? 1 : 0;
  const effectiveMaxSlots = Math.max(providerReferenceSlots, forkSetupSlots);
  const hasReferenceBudget = currentMediaGroup === 'image' || currentMediaGroup === 'video';
  const isOverReferenceBudget =
    operation !== 'fork' &&
    hasPrompt &&
    hasReferenceBudget &&
    slots.length + styleImageCount > referenceSlotLimit;
  const referenceNoun = referenceSlotLimit === 1 ? 'reference' : 'references';
  const styleSuffix = styleImageCount > 0 ? ' including style' : '';
  const imageBudgetAction = slots.length > 0
    ? `Remove references${imageModel === 'flash' ? ' or switch Pro' : ''}.`
    : `Reduce style images${imageModel === 'flash' ? ' or switch Pro' : ''}.`;
  const referenceBudgetWarning = isOverReferenceBudget && currentMediaGroup === 'image'
    ? `${imageModel === 'flash' ? 'Flash' : 'Pro'} supports ${referenceSlotLimit} ${referenceNoun}${styleSuffix}. ${imageBudgetAction}`
    : isOverReferenceBudget && currentMediaGroup === 'video'
      ? `Video supports ${referenceSlotLimit} references${styleSuffix}. Remove references or reduce style images.`
      : null;
  const effectiveBatchCount = mediaModeConfig.supportsBatch ? batchCount : 1;
  const videoStyleApplies = mediaMode === 'video' && !styleOverride && styleImageCount > 0;
  const veoImageSlotIds = useMemo(
    () => slots.filter(isVeoImageInput).map((slot) => slot.id),
    [slots]
  );
  const styleReferenceCollections = useMemo(
    () => collections.filter((collection) => collection.kind === 'style_refs'),
    [collections],
  );
  const customStyleOptions = useMemo(() => {
    const options: Array<{ variantId: string; label: string; collectionName: string }> = [];
    const seen = new Set<string>();
    for (const collection of styleReferenceCollections) {
      for (const variantId of getCollectionStyleVariantIds(collection.id, collectionItems, allAssets, allVariants)) {
        if (seen.has(variantId)) continue;
        const variant = allVariants.find((candidate) => candidate.id === variantId);
        const asset = variant ? allAssets.find((candidate) => candidate.id === variant.asset_id) : null;
        if (!variant || !asset) continue;
        seen.add(variantId);
        options.push({
          variantId,
          label: asset.name,
          collectionName: collection.name,
        });
      }
    }
    return options;
  }, [allAssets, allVariants, collectionItems, styleReferenceCollections]);
  const selectedStyleControlValue = styleSelection.mode === 'preset'
    ? `preset:${styleSelection.presetId}`
    : styleSelection.mode;

  // Auto-generated asset name: "<Group> <next index>" (e.g. "Image 3").
  const assetCountForKind = useMemo(
    () => allAssets.filter((a) => a.media_kind === selectedMediaKind).length,
    [allAssets, selectedMediaKind]
  );
  const defaultAssetName = `${MEDIA_GROUP_LABEL[currentMediaGroup]} ${assetCountForKind + 1}`;
  const nameValue = nameEdited ? newAssetName : defaultAssetName;
  const effectiveAssetName = nameEdited && newAssetName.trim() ? newAssetName.trim() : defaultAssetName;

  const baseLabel = getOperationLabel(operation, mediaMode);
  const operationLabel = effectiveBatchCount > 1 ? `${baseLabel} ×${effectiveBatchCount}` : baseLabel;
  const placeholder = getPlaceholder(slots.length, operation, mediaMode);

  // Slot variant IDs for vision-aware operations
  const slotVariantIds = useMemo(() => slots.map(s => s.variant.id), [slots]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      const newHeight = Math.min(Math.max(textarea.scrollHeight, 60), 220);
      textarea.style.height = `${newHeight}px`;
    }
  }, [prompt]);

  useEffect(() => {
    if (!mediaModeConfig.supportsBatch && batchCount > 1) {
      setBatchCount(1);
    }
  }, [mediaModeConfig.supportsBatch, batchCount]);

  useEffect(() => {
    if (!isImageSizeSupportedByModel(imageModel, imageSize)) {
      setImageSize(imageModelCapabilities.supportedImageSizes[0]);
    }
  }, [imageModel, imageModelCapabilities, imageSize]);

  useEffect(() => {
    setMaxSlots(effectiveMaxSlots);
  }, [effectiveMaxSlots, setMaxSlots]);

  useEffect(() => {
    if (
      styleSelection.mode === 'preset' &&
      !enabledStylePresets.some((preset) => preset.id === styleSelection.presetId)
    ) {
      setStyleSelection({ mode: 'default' });
    }
  }, [enabledStylePresets, styleSelection]);

  const handleSelectGroup = useCallback((group: MediaGroup) => {
    if (group === 'image') {
      setMediaMode('image');
    } else if (group === 'video') {
      setMediaMode('video');
    } else {
      setMediaMode(lastAudioMode);
    }
  }, [lastAudioMode]);

  const handleSelectAudioMode = useCallback((mode: ForgeMediaMode) => {
    setMediaMode(mode);
    setLastAudioMode(mode);
  }, []);

  const handleStyleSelectionChange = useCallback((value: string) => {
    if (value === 'default') {
      setStyleSelection({ mode: 'default' });
      setShowStylePanel(false);
    } else if (value === 'none') {
      setStyleSelection({ mode: 'none' });
      setShowStylePanel(false);
    } else if (value === 'custom') {
      setStyleSelection((current) => ({
        mode: 'custom',
        variantIds: current.mode === 'custom' ? current.variantIds : [],
      }));
      setShowStylePanel(true);
    } else if (value === 'manage') {
      setShowStylePanel(true);
    } else if (value.startsWith('preset:')) {
      setStyleSelection({ mode: 'preset', presetId: value.slice('preset:'.length) });
      setShowStylePanel(false);
    }
  }, []);

  const handleToggleCustomStyleVariant = useCallback((variantId: string) => {
    setStyleSelection((current) => {
      const currentIds = current.mode === 'custom' ? current.variantIds : [];
      const nextIds = currentIds.includes(variantId)
        ? currentIds.filter((id) => id !== variantId)
        : [...currentIds, variantId];
      return { mode: 'custom', variantIds: nextIds };
    });
  }, []);

  const handleNameChange = useCallback((value: string) => {
    setNameEdited(true);
    setNewAssetName(value);
  }, []);

  const handleAddClick = useCallback(() => {
    setShowAssetPicker(true);
  }, []);

  const handleCloseAssetPicker = useCallback(() => {
    setShowAssetPicker(false);
  }, []);

  const handleUploadClick = useCallback(() => {
    uploadInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset file input so same file can be selected again
    if (uploadInputRef.current) {
      uploadInputRef.current.value = '';
    }

    // If we have a target asset, upload to it directly
    if (targetAsset && onUpload) {
      try {
        await onUpload(file, targetAsset.id);
      } catch (error) {
        console.error('Upload failed:', error);
      }
      return;
    }

    // No target asset - need to create new asset
    if (onUploadNewAsset) {
      // Use filename (without extension) as default name
      const defaultName = file.name.replace(/\.[^/.]+$/, '');
      setPendingUploadFile(file);
      setUploadAssetName(defaultName);
      setShowUploadPrompt(true);
    }
  }, [targetAsset, onUpload, onUploadNewAsset]);

  const handleUploadPromptSubmit = useCallback(async () => {
    if (!pendingUploadFile || !onUploadNewAsset || !uploadAssetName.trim()) return;

    try {
      await onUploadNewAsset(pendingUploadFile, uploadAssetName.trim());
    } catch (error) {
      console.error('Upload failed:', error);
    }

    // Clean up
    setPendingUploadFile(null);
    setUploadAssetName('');
    setShowUploadPrompt(false);
  }, [pendingUploadFile, onUploadNewAsset, uploadAssetName]);

  const handleUploadPromptCancel = useCallback(() => {
    setPendingUploadFile(null);
    setUploadAssetName('');
    setShowUploadPrompt(false);
  }, []);

  // Drag-and-drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Allow drag if we can upload to existing asset OR create new asset
    if (!onUpload && !onUploadNewAsset) return;
    if (!targetAsset && !onUploadNewAsset) return;
    setIsDragOver(true);
  }, [onUpload, onUploadNewAsset, targetAsset]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    const uploadFile = files.find(f => ACCEPTED_UPLOAD_MIME_TYPES.includes(f.type));

    if (!uploadFile) {
      console.warn('No valid media file dropped');
      return;
    }

    // If we have a target asset, upload to it directly
    if (targetAsset && onUpload) {
      try {
        await onUpload(uploadFile, targetAsset.id);
      } catch (error) {
        console.error('Drop upload failed:', error);
      }
      return;
    }

    // No target asset - need to create new asset
    if (onUploadNewAsset) {
      const defaultName = uploadFile.name.replace(/\.[^/.]+$/, '');
      setPendingUploadFile(uploadFile);
      setUploadAssetName(defaultName);
      setShowUploadPrompt(true);
    }
  }, [onUpload, onUploadNewAsset, targetAsset]);

  const handleRemoveSlot = useCallback((e: React.MouseEvent, slotId: string) => {
    e.stopPropagation();
    removeSlot(slotId);
  }, [removeSlot]);

  const handleSelectMusicProvider = useCallback((provider: MusicGenerationProvider) => {
    setMusicProvider(provider);
    setMusicProviderExplicit(true);
  }, []);

  const handleSubmit = useCallback(async () => {
    // Fork doesn't need prompt; others do
    if (operation !== 'fork' && !prompt.trim()) return;
    // Refine with no prompt is a no-op
    if (operation === 'refine' && !prompt.trim()) return;
    // Forge operations cannot consume references from a different media mode.
    if (hasIncompatibleMediaSlots) return;
    if (isOverReferenceBudget) return;
    if (activeEstimate?.success && activeEstimate.estimate && !activeEstimate.estimate.allowed) return;

    setIsSubmitting(true);
    try {
      // When creating a new asset from existing slots, inherit type only.
      const sourceAsset = slots.length > 0 ? slots[0].asset : null;
      const assetType = getAssetTypeForForgeMode(mediaMode, sourceAsset?.type);

      // For fork operation, prompt should be undefined (copy without modification)
      const trimmedPrompt = prompt.trim();

      onSubmit({
        prompt: trimmedPrompt || undefined,
        mediaKind: selectedMediaKind,
        referenceVariantIds: slots.map(s => s.variant.id),
        destination: {
          type: effectiveDestinationType,
          assetId: effectiveDestinationType === 'existing_asset' && targetAsset ? targetAsset.id : undefined,
          assetName: effectiveDestinationType === 'new_asset' ? effectiveAssetName : undefined,
          assetType: effectiveDestinationType === 'new_asset' ? assetType : undefined,
        },
        operation,
        batchCount: effectiveBatchCount > 1 ? effectiveBatchCount : undefined,
        batchMode: effectiveBatchCount > 1 ? batchMode : undefined,
        model: selectedMediaKind === 'image' ? imageModel : undefined,
        aspectRatio: selectedMediaKind === 'image' ? aspectRatio : undefined,
        imageSize: selectedMediaKind === 'image' ? imageSize : undefined,
        disableStyle:
          isAudioMode ||
          styleSelection.mode === 'none' ||
          (styleSelection.mode === 'custom' && styleVariantIds.length === 0) ||
          undefined,
        stylePresetId: !isAudioMode && styleSelection.mode === 'preset' ? styleSelection.presetId : undefined,
        styleVariantIds: !isAudioMode && styleSelection.mode === 'custom' && styleVariantIds.length > 0 ? styleVariantIds : undefined,
        voiceId: mediaMode === 'speech' ? voiceId : undefined,
        videoResolution: mediaMode === 'video' ? videoResolution : undefined,
        videoDurationSeconds: mediaMode === 'video' ? videoDurationSeconds : undefined,
        videoTier: mediaMode === 'video' ? videoTier : undefined,
        // Keep positions intact — each entry maps to a speaker in order. Every
        // speaker needs its own voice (no server-side default), so filtering
        // here would shift later voices onto earlier speakers.
        dialogueVoiceIds: mediaMode === 'dialogue' && dialogueVoiceIds.some(Boolean)
          ? dialogueVoiceIds
          : undefined,
        musicProvider: mediaMode === 'music' && musicProviderExplicit ? musicProvider : undefined,
      });

      // Clear on success
      clearSlots();
      setPrompt('');
      setNewAssetName('');
      setNameEdited(false);
      setDestinationType('existing_asset');
      setStyleSelection({ mode: 'default' });
      setBatchCount(1);
      setVoiceId(undefined);
      setDialogueVoiceIds([]);
      setMusicProvider('elevenlabs');
      setMusicProviderExplicit(false);
      setVideoResolution(DEFAULT_VIDEO_GENERATION_RESOLUTION);
      setVideoDurationSeconds(DEFAULT_VIDEO_GENERATION_DURATION_SECONDS);
      setVideoTier(DEFAULT_VIDEO_GENERATION_TIER);
    } catch (error) {
      console.error('Forge submit failed:', error);
    } finally {
      setIsSubmitting(false);
    }
  }, [prompt, effectiveDestinationType, effectiveAssetName, slots, targetAsset, onSubmit, clearSlots, setPrompt, operation, mediaMode, selectedMediaKind, isAudioMode, hasIncompatibleMediaSlots, isOverReferenceBudget, activeEstimate, effectiveBatchCount, batchMode, imageModel, aspectRatio, imageSize, styleSelection, styleVariantIds, voiceId, dialogueVoiceIds, musicProvider, musicProviderExplicit, videoResolution, videoDurationSeconds, videoTier]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  const handleDestinationKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (isSubmitting) return;

    const selectDestination = (nextDestination: DestinationType) => {
      const resolvedDestination = nextDestination === 'existing_asset' && !canUseExistingDestination
        ? 'new_asset'
        : nextDestination;
      e.preventDefault();
      setDestinationType(resolvedDestination);
      const targetRef = resolvedDestination === 'existing_asset' ? currentDestinationRef : newDestinationRef;
      requestAnimationFrame(() => targetRef.current?.focus());
    };

    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      selectDestination(destinationType === 'existing_asset' ? 'new_asset' : 'existing_asset');
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      selectDestination(destinationType === 'existing_asset' ? 'new_asset' : 'existing_asset');
    } else if (e.key === 'Home') {
      selectDestination('existing_asset');
    } else if (e.key === 'End') {
      selectDestination('new_asset');
    }
  }, [canUseExistingDestination, destinationType, isSubmitting]);

  // Toggle chat panel
  const handleToggleChat = useCallback(() => {
    setShowChat(prev => !prev);
  }, []);

  // Handle applying suggested prompt from chat
  const handleApplyPrompt = useCallback((newPrompt: string) => {
    setPrompt(newPrompt);
  }, [setPrompt]);

  // Determine if submit is allowed
  const canSubmit = useMemo(() => {
    if (isSubmitting) return false;
    if (effectiveDestinationType === 'existing_asset' && !canUseExistingDestination) return false;
    if (hasIncompatibleMediaSlots) return false;
    if (isOverReferenceBudget) return false;

    // Fork: 1 slot, no prompt needed (asset name is auto-generated)
    if (operation === 'fork') return true;

    // Everything else needs a prompt
    return hasPrompt;
  }, [isSubmitting, operation, hasPrompt, effectiveDestinationType, canUseExistingDestination, hasIncompatibleMediaSlots, isOverReferenceBudget]);

  useEffect(() => {
    if (!generationEstimate || generationEstimate.requestId !== estimateRequestIdRef.current) {
      return;
    }
    setEstimateLoading(false);
    setActiveEstimate(generationEstimate);
  }, [generationEstimate]);

  useEffect(() => {
    if (!sendGenerationEstimateRequest || !canSubmit || operation === 'fork') {
      estimateRequestIdRef.current = null;
      setEstimateLoading(false);
      setActiveEstimate(null);
      return;
    }

    const timeout = window.setTimeout(() => {
      const sourceAsset = slots.length > 0 ? slots[0].asset : null;
      const assetType = effectiveDestinationType === 'new_asset'
        ? getAssetTypeForForgeMode(mediaMode, sourceAsset?.type)
        : targetAsset?.type;
      const estimateOperation = effectiveBatchCount > 1 && effectiveDestinationType === 'new_asset'
        ? 'batch'
        : operation;
      const requestId = sendGenerationEstimateRequest({
        operation: estimateOperation,
        assetId: effectiveDestinationType === 'existing_asset' ? targetAsset?.id : undefined,
        assetType,
        mediaKind: selectedMediaKind,
        prompt: prompt.trim() || undefined,
        count: effectiveBatchCount,
        model: selectedMediaKind === 'image' ? imageModel : undefined,
        imageSize: selectedMediaKind === 'image' ? imageSize : undefined,
        musicProvider: mediaMode === 'music' && musicProviderExplicit ? musicProvider : undefined,
        generateAudio: mediaMode === 'video' ? VIDEO_GENERATION_AUDIO_ALWAYS_ON : undefined,
        videoResolution: mediaMode === 'video' ? videoResolution : undefined,
        videoDurationSeconds: mediaMode === 'video' ? videoDurationSeconds : undefined,
        videoTier: mediaMode === 'video' ? videoTier : undefined,
      });
      estimateRequestIdRef.current = requestId;
      setActiveEstimate(null);
      setEstimateLoading(true);
    }, 350);

    return () => window.clearTimeout(timeout);
  }, [
    sendGenerationEstimateRequest,
    canSubmit,
    operation,
    slots,
    effectiveDestinationType,
    mediaMode,
    targetAsset,
    selectedMediaKind,
    prompt,
    effectiveBatchCount,
    imageModel,
    imageSize,
    musicProvider,
    musicProviderExplicit,
    videoResolution,
    videoDurationSeconds,
    videoTier,
  ]);

  const canAddMore = slots.length < effectiveMaxSlots;
  // Show destination toggle on AssetDetailPage (has currentAsset) so user can choose existing vs new
  const showDestinationToggle = !!currentAsset;
  const showNameInput = effectiveDestinationType === 'new_asset';
  const showStyleControls = mediaModeConfig.supportsStyle;
  const showBatchControls = effectiveDestinationType === 'new_asset' && mediaModeConfig.supportsBatch;
  // Empty-state reference add lives in the control bar; once slots exist the
  // thumbnail strip carries its own "+".
  const showUpload = !!((onUpload && targetAsset) || onUploadNewAsset);
  const estimate = activeEstimate?.success ? activeEstimate.estimate : undefined;
  const estimateError = activeEstimate && !activeEstimate.success ? activeEstimate.error : undefined;
  const estimateMeterLabel = estimate ? ESTIMATE_METER_LABELS[estimate.meterEventName] ?? estimate.meterEventName : '';
  const estimateRemaining = estimate?.quota?.remaining;
  const estimateRemainingLabel = typeof estimateRemaining === 'number'
    ? `${estimateRemaining.toLocaleString()} remaining`
    : null;

  const handleMediaGroupSelect = useCallback((value: string) => {
    handleSelectGroup(value as MediaGroup);
  }, [handleSelectGroup]);

  // Per-mode options row visibility
  const showOptionsRow =
    currentMediaGroup === 'image' ||
    currentMediaGroup === 'audio' ||
    currentMediaGroup === 'video' ||
    showBatchControls ||
    showStyleControls;

  const imageSizeOptions = useMemo<Array<SelectOption<ImageSize>>>(
    () => IMAGE_SIZES.map((size) => ({
      value: size,
      label: size,
      disabled: !isImageSizeSupportedByModel(imageModel, size),
    })),
    [imageModel],
  );

  const batchCountOptions = useMemo<Array<SelectOption<string>>>(
    () => [1, 2, 4, 8].map((count) => ({
      value: String(count),
      label: `x${count}`,
    })),
    [],
  );

  const videoResolutionOptions = useMemo<Array<SelectOption<VideoGenerationResolution>>>(
    () => VIDEO_GENERATION_RESOLUTIONS.map((resolution) => ({
      value: resolution,
      label: resolution,
      disabled: !isVideoGenerationResolutionSupportedForTier(resolution, videoTier),
    })),
    [videoTier],
  );

  const videoDurationOptions = useMemo<Array<SelectOption<string>>>(
    () => VIDEO_GENERATION_DURATION_SECONDS.map((duration) => ({
      value: String(duration),
      label: `${duration}s`,
    })),
    [],
  );

  const audioModeOptions = useMemo<Array<SelectOption<ForgeMediaMode>>>(
    () => AUDIO_MODE_CONFIGS.map((config) => ({
      value: config.mode,
      label: config.shortLabel,
      textValue: config.label,
    })),
    [],
  );

  const styleSelectOptions = useMemo<Array<SelectOption<string>>>(
    () => [
      { value: 'default', label: 'Default' },
      ...enabledStylePresets.map((preset) => ({
        value: `preset:${preset.id}`,
        label: preset.name,
      })),
      { value: 'none', label: 'No style' },
      {
        value: 'custom',
        label: styleVariantIds.length > 0 ? `Custom refs (${styleVariantIds.length})` : 'Custom refs',
      },
      { value: 'manage', label: 'Manage styles...' },
    ],
    [enabledStylePresets, styleVariantIds.length],
  );

  const isTrayExpanded =
    trayFocused ||
    prompt.trim().length > 0 ||
    slots.length > 0 ||
    showStylePanel ||
    showChat;

  // Build tray class with drag-over state
  const trayClasses = [styles.tray];
  if (!floating) trayClasses.push(styles.embedded);
  if (onBrandBackground) trayClasses.push(styles.onBrandBackground);
  if (isDragOver) trayClasses.push(styles.dragOver);
  if (isTrayExpanded) trayClasses.push(styles.expanded);
  const trayClass = trayClasses.join(' ');

  return (
    <>
      <div
        className={trayClass}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onFocus={() => setTrayFocused(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setTrayFocused(false);
          }
        }}
      >
        {contextSlot && (
          <div
            className={styles.contextSlot}
            onFocusCapture={(e) => e.stopPropagation()}
          >
            {contextSlot}
          </div>
        )}
        <div className={styles.inputArea}>
          {/* Asset-detail destination toggle. Context lives in the slot above. */}
          {showDestinationToggle && (
            <>
              {/* The destination toggle sits above the collapsible options. Stop
                  its focus from expanding the tray so the buttons don't shift out
                  from under a click (the tray grows upward). Blur must still
                  bubble, otherwise focus leaving the header for outside the tray
                  would never reach the tray handler and it would stay expanded. */}
              <div
                className={styles.destinationHeader}
                onFocusCapture={(e) => e.stopPropagation()}
              >
                <span className={styles.destinationLabel}>Destination</span>
                <div
                  className={styles.miniSeg}
                  role="radiogroup"
                  aria-label="Destination"
                  onKeyDown={handleDestinationKeyDown}
                >
                  <button
                    ref={currentDestinationRef}
                    type="button"
                    role="radio"
                    aria-checked={destinationType === 'existing_asset'}
                    className={`${styles.miniSegText} ${destinationType === 'existing_asset' ? styles.active : ''}`}
                    onClick={() => setDestinationType('existing_asset')}
                    disabled={isSubmitting || !canUseExistingDestination}
                    tabIndex={destinationType === 'existing_asset' ? 0 : -1}
                    title={!canUseExistingDestination ? `${mediaModeConfig.label} mode creates ${selectedMediaKind} assets` : 'Add to current asset'}
                  >
                    Current
                  </button>
                  <button
                    ref={newDestinationRef}
                    type="button"
                    role="radio"
                    aria-checked={destinationType === 'new_asset'}
                    className={`${styles.miniSegText} ${destinationType === 'new_asset' ? styles.active : ''}`}
                    onClick={() => setDestinationType('new_asset')}
                    disabled={isSubmitting}
                    tabIndex={destinationType === 'new_asset' ? 0 : -1}
                    title="Create new asset"
                  >
                    New
                  </button>
                </div>
              </div>
              <div className={styles.hairline} />
            </>
          )}

          {/* Prompt — the hero. Everything else is in service of this line. */}
          <textarea
            ref={textareaRef}
            className={styles.promptTextarea}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={isSubmitting}
            rows={1}
            aria-label="Prompt"
          />

          {/* Mode + per-mode options — collapsed to a compact bar until the tray is engaged */}
          <div
            className={`${styles.optionsReveal} ${isTrayExpanded ? styles.optionsRevealOpen : ''}`}
            data-testid="forge-options-reveal"
          >
            <div className={styles.optionsRevealInner}>
              {showOptionsRow && (
                <div className={styles.optionsRow}>
                  <UiSelect
                    className={styles.selectMode}
                    value={currentMediaGroup}
                    options={MEDIA_GROUP_SELECT_OPTIONS}
                    onValueChange={handleMediaGroupSelect}
                    disabled={isSubmitting}
                    label="Media type"
                    title="Media type"
                  />
                  <span className={styles.optionsDivider} aria-hidden="true" />
                  {currentMediaGroup === 'image' && (
                    <>
                      <UiSelect
                        className={styles.selectParam}
                        value={imageModel}
                        options={IMAGE_MODEL_SELECT_OPTIONS}
                        onValueChange={setImageModel}
                        disabled={isSubmitting}
                        label="Image model"
                        title="Image model"
                      />
                      <UiSelect
                        className={styles.selectParam}
                        value={imageSize}
                        options={imageSizeOptions}
                        onValueChange={setImageSize}
                        disabled={isSubmitting}
                        label="Image size"
                        title="Image size"
                      />
                      <UiSelect
                        className={styles.selectParam}
                        value={aspectRatio}
                        options={IMAGE_ASPECT_RATIO_SELECT_OPTIONS}
                        onValueChange={setAspectRatio}
                        disabled={isSubmitting}
                        label="Aspect ratio"
                        title="Aspect ratio"
                      />
                  {showBatchControls && (
                    <UiSelect
                      className={styles.selectParam}
                      value={String(batchCount)}
                      options={batchCountOptions}
                      onValueChange={(nextValue) => setBatchCount(Number(nextValue))}
                      disabled={isSubmitting}
                      label="Batch count"
                      title="Batch count"
                    />
                  )}
                  {effectiveBatchCount > 1 && showBatchControls && (
                    <UiSelect
                      className={styles.selectParam}
                      value={batchMode}
                      options={[
                        { value: 'explore', label: 'Explore' },
                        { value: 'set', label: 'Set' },
                      ]}
                      onValueChange={setBatchMode}
                      disabled={isSubmitting}
                      label="Batch mode"
                      title="Batch mode"
                    />
                  )}
                </>
              )}

              {currentMediaGroup === 'video' && (
                <>
                  <UiSelect
                    className={styles.selectParam}
                    value={videoTier}
                    options={VIDEO_TIER_SELECT_OPTIONS}
                    onValueChange={handleVideoTierSelect}
                    disabled={isSubmitting}
                    label="Video tier"
                    title="Video tier"
                  />
                  <UiSelect
                    className={styles.selectParam}
                    value={videoResolution}
                    options={videoResolutionOptions}
                    onValueChange={setVideoResolution}
                    disabled={isSubmitting}
                    label="Video resolution"
                    title="Video resolution"
                  />
                  <UiSelect
                    className={styles.selectParam}
                    value={String(videoDurationSeconds)}
                    options={videoDurationOptions}
                    onValueChange={(nextValue) => setVideoDurationSeconds(Number(nextValue) as VideoGenerationDurationSeconds)}
                    disabled={isSubmitting}
                    label="Video duration"
                    title="Video duration"
                  />
                </>
              )}

              {currentMediaGroup === 'audio' && (
                <>
                  <UiSelect
                    className={styles.selectParam}
                    value={mediaMode}
                    options={audioModeOptions}
                    onValueChange={handleSelectAudioMode}
                    disabled={isSubmitting}
                    label="Audio type"
                    title="Audio type"
                  />
                  {showVoicePicker && (
                    <>
                      <div className={styles.optSpacer} />
                      <VoicePicker
                        mode={mediaMode === 'dialogue' ? 'dialogue' : 'speech'}
                        disabled={isSubmitting}
                        voiceId={voiceId}
                        onVoiceIdChange={setVoiceId}
                        dialogueVoiceIds={dialogueVoiceIds}
                        onDialogueVoiceIdsChange={setDialogueVoiceIds}
                      />
                    </>
                  )}
                  {mediaMode === 'music' && (
                    <UiSelect
                      className={styles.selectParam}
                      value={musicProvider}
                      options={MUSIC_PROVIDER_SELECT_OPTIONS}
                      onValueChange={handleSelectMusicProvider}
                      disabled={isSubmitting}
                      label="Music provider"
                      title="Music provider"
                    />
                  )}
                </>
              )}

              {showStyleControls && (
                <>
                  <UiSelect
                    className={styles.selectStyle}
                    value={selectedStyleControlValue}
                    options={styleSelectOptions}
                    onValueChange={handleStyleSelectionChange}
                    disabled={isSubmitting}
                    label="Style selector"
                    title="Style selector"
                  />
                </>
              )}
            </div>
          )}
            </div>
          </div>

          {/* References — only when present; the empty-state add lives in the control bar */}
          {slots.length > 0 && (
            <div className={styles.thumbsRow}>
              {slots.map((slot) => {
                const veoImageIndex = veoImageSlotIds.indexOf(slot.id);
                let slotBadge: string | null = null;
                if (currentMediaGroup === 'video' && veoImageIndex >= 0) {
                  if (videoStyleApplies || veoImageSlotIds.length > 2) {
                    slotBadge = 'Ref';
                  } else if (veoImageSlotIds.length === 1) {
                    slotBadge = 'Image';
                  } else if (veoImageIndex === 0) {
                    slotBadge = 'Start';
                  } else if (veoImageIndex === 1) {
                    slotBadge = 'End';
                  }
                }

                return (
                  <div key={slot.id} className={styles.slotThumb}>
                    <Thumbnail
                      variant={slot.variant}
                      size="fill"
                      spaceId={spaceId}
                      className={styles.slotPreview}
                    />
                    {slotBadge && <span className={styles.slotBadge}>{slotBadge}</span>}
                    <button
                      className={styles.removeButton}
                      onClick={(e) => handleRemoveSlot(e, slot.id)}
                      title="Remove"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="8" height="8">
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                    <span className={styles.slotTooltip}>{slot.asset.name}</span>
                  </div>
                );
              })}
              {canAddMore && (
                <button
                  className={styles.addThumbButton}
                  onClick={handleAddClick}
                  title="Add reference"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
              )}
            </div>
          )}

          <div className={styles.hairline} />

          {/* Control bar: reference actions + submit */}
          <div className={styles.controlBar}>
            <div className={styles.controlBarLeft}>
              {/* References (image/video) */}
              {currentMediaGroup !== 'audio' && canAddMore && (
                <IconButton
                  type="button"
                  className={`${styles.controlIconAction} ${slots.length > 0 ? styles.active : ''}`}
                  onClick={handleAddClick}
                  disabled={isSubmitting}
                  title="Add reference"
                  aria-label="Add reference"
                  variant="ghost"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                    <rect x="3" y="3" width="13" height="13" rx="2.5" />
                    <path d="M8 21h11a2 2 0 0 0 2-2V8" />
                  </svg>
                </IconButton>
              )}

              {/* Upload */}
              {showUpload && (
                <IconButton
                  type="button"
                  className={styles.controlIconAction}
                  onClick={handleUploadClick}
                  disabled={isSubmitting || isUploading}
                  title={targetAsset ? `Upload media to "${targetAsset.name}"` : 'Upload media to create new asset'}
                  aria-label="Upload media"
                  variant="ghost"
                >
                  {isUploading ? (
                    <span className={styles.spinner} />
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                  )}
                </IconButton>
              )}

              {/* Chat (all modes) */}
              {sendChatMessage && (
                <IconButton
                  type="button"
                  className={`${styles.controlIconAction} ${showChat ? styles.active : ''}`}
                  onClick={handleToggleChat}
                  disabled={isSubmitting}
                  title="Chat with Claude about your prompt"
                  aria-label="Chat"
                  variant="ghost"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" width="16" height="16">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </IconButton>
              )}
            </div>

            <div className={styles.controlBarRight}>
              {/* Name — auto-generated, quietly editable (new asset only; existing shows in header) */}
              {showNameInput && (
                <TextInput
                  className={styles.nameChip}
                  value={nameValue}
                  onChange={(e) => handleNameChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={isSubmitting}
                  spellCheck={false}
                  aria-label="Asset name"
                  title="Auto-named — click to rename"
                />
              )}

              <Button
                className={styles.forgeButton}
                onClick={handleSubmit}
                disabled={!canSubmit || estimate?.allowed === false}
                title={`${operationLabel} (Cmd+Enter)`}
                variant="primary"
              >
                {isSubmitting ? (
                  <span className={styles.spinner} />
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                )}
                <span className={styles.buttonLabel}>{operationLabel}</span>
                <span className={styles.kbd} aria-hidden="true">↵</span>
              </Button>
            </div>
          </div>

          {/* Forge error message */}
          {forgeError && (
            <div className={styles.forgeError}>
              <span>{forgeError}</span>
              {forgeErrorCode === 'PAID_GENERATION_REQUIRED' && (
                <Link to="/profile" className={styles.forgeErrorAction}>
                  Upgrade
                </Link>
              )}
            </div>
          )}

          {(estimateLoading || estimate || estimateError) && (
            <div className={`${styles.estimateRow} ${estimate && !estimate.allowed ? styles.estimateBlocked : ''}`}>
              {estimateLoading && !estimate && !estimateError ? (
                <span>Estimating usage...</span>
              ) : estimate ? (
                <>
                  <span>{formatEstimatedUsd(estimate.providerCostMicroUsd)} est. provider cost</span>
                  <span>{formatEstimateQuantity(estimate.quotaQuantity, estimateMeterLabel)}</span>
                  <span>{formatEstimateQuantity(estimate.platformWorkflowRuns, 'workflow')}</span>
                  {estimate.billingMode === 'byok' && <span>BYOK</span>}
                  {estimateRemainingLabel && <span>{estimateRemainingLabel}</span>}
                  {!estimate.allowed && estimate.denyMessage && <span>{estimate.denyMessage}</span>}
                </>
              ) : (
                <span>{estimateError}</span>
              )}
            </div>
          )}

          {hasIncompatibleMediaSlots && (
            <div className={styles.modeWarning}>
              {mediaModeConfig.label} mode uses {formatMediaKindList(mediaModeConfig.compatibleSlotMediaKinds)} references. Remove incompatible slots or switch mode.
            </div>
          )}

          {referenceBudgetWarning && (
            <div className={styles.modeWarning}>
              {referenceBudgetWarning}
            </div>
          )}
        </div>
      </div>

      {/* StylePanel - full sheet overlay */}
      {showStylePanel && mediaModeConfig.supportsStyle && spaceId && (
        <StylePanel
          spaceId={spaceId}
          onClose={() => setShowStylePanel(false)}
          stylePresets={stylePresets}
          styleReferenceCollections={styleReferenceCollections}
          customStyleOptions={customStyleOptions}
          customStyleVariantIds={styleVariantIds}
          onToggleCustomStyleVariant={handleToggleCustomStyleVariant}
          createStylePreset={createStylePreset}
          updateStylePreset={updateStylePreset}
          deleteStylePreset={deleteStylePreset}
        />
      )}

      {/* ForgeChat - full sheet overlay */}
      {showChat && sendChatMessage && requestChatHistory && clearChatSession && (
        <ForgeChat
          currentPrompt={prompt}
          slotVariantIds={slotVariantIds}
          messages={chatMessages}
          isLoading={isChatLoading}
          lastProgress={chatProgress}
          error={chatError}
          historyLoaded={chatHistoryLoaded}
          sendMessage={sendChatMessage}
          requestHistory={requestChatHistory}
          clearChat={clearChatSession}
          onApplyPrompt={handleApplyPrompt}
          onClose={() => setShowChat(false)}
        />
      )}

      {showAssetPicker && (
        <AssetPickerModal
          allAssets={allAssets}
          allVariants={allVariants}
          onClose={handleCloseAssetPicker}
          spaceId={spaceId}
          mediaMode={mediaMode}
        />
      )}

      {/* Hidden file input for uploads */}
      <input
        ref={uploadInputRef}
        type="file"
        accept={ACCEPTED_UPLOAD_TYPES}
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />

      {/* Upload prompt modal for creating new asset */}
      {showUploadPrompt && (
        <div className={styles.uploadPromptOverlay} onClick={handleUploadPromptCancel}>
          <div className={styles.uploadPromptModal} onClick={(e) => e.stopPropagation()}>
            <h3 className={styles.uploadPromptTitle}>Create New Asset</h3>
            <p className={styles.uploadPromptDescription}>
              Enter a name for the new asset that will be created from your uploaded media file.
            </p>
            <TextInput
              className={styles.uploadPromptInput}
              value={uploadAssetName}
              onChange={(e) => setUploadAssetName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleUploadPromptSubmit();
                if (e.key === 'Escape') handleUploadPromptCancel();
              }}
              placeholder="Asset name"
              autoFocus
              fullWidth
            />
            <div className={styles.uploadPromptActions}>
              <Button
                onClick={handleUploadPromptCancel}
                variant="secondary"
              >
                Cancel
              </Button>
              <Button
                onClick={handleUploadPromptSubmit}
                disabled={!uploadAssetName.trim() || isUploading}
                variant="primary"
              >
                {isUploading ? 'Uploading...' : 'Create Asset'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default ForgeTray;
