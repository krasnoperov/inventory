export const IMAGE_MODEL_SELECTIONS = ['pro', 'flash'] as const;
export type ImageModelSelection = typeof IMAGE_MODEL_SELECTIONS[number];

export const IMAGE_MODEL_IDS = {
  pro: 'gemini-3-pro-image-preview',
  flash: 'gemini-2.5-flash-image',
} as const;
export type ImageModelId = typeof IMAGE_MODEL_IDS[ImageModelSelection];

export const DEFAULT_IMAGE_MODEL_SELECTION = 'pro' satisfies ImageModelSelection;
export const DEFAULT_IMAGE_MODEL_ID = IMAGE_MODEL_IDS[DEFAULT_IMAGE_MODEL_SELECTION];

export const IMAGE_ASPECT_RATIOS = ['1:1', '16:9', '9:16', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '21:9'] as const;
export type ImageAspectRatio = typeof IMAGE_ASPECT_RATIOS[number];

export const IMAGE_SIZES = ['1K', '2K', '4K'] as const;
export type ImageSize = typeof IMAGE_SIZES[number];

export interface ImageModelCapabilities {
  selection: ImageModelSelection;
  modelId: ImageModelId;
  maxReferenceImages: number;
  supportedImageSizes: readonly ImageSize[];
  supportedAspectRatios: readonly ImageAspectRatio[];
}

export const IMAGE_MODEL_CAPABILITIES = {
  pro: {
    selection: 'pro',
    modelId: IMAGE_MODEL_IDS.pro,
    maxReferenceImages: 14,
    supportedImageSizes: ['1K', '2K', '4K'],
    supportedAspectRatios: IMAGE_ASPECT_RATIOS,
  },
  flash: {
    selection: 'flash',
    modelId: IMAGE_MODEL_IDS.flash,
    maxReferenceImages: 1,
    supportedImageSizes: ['1K'],
    supportedAspectRatios: IMAGE_ASPECT_RATIOS,
  },
} as const satisfies Record<ImageModelSelection, ImageModelCapabilities>;

export function resolveImageModelSelection(selection?: ImageModelSelection): ImageModelId {
  return IMAGE_MODEL_CAPABILITIES[selection ?? DEFAULT_IMAGE_MODEL_SELECTION].modelId;
}

export function isImageModelSelection(value: string): value is ImageModelSelection {
  return (IMAGE_MODEL_SELECTIONS as readonly string[]).includes(value);
}

export function isImageModelId(value: string): value is ImageModelId {
  return (Object.values(IMAGE_MODEL_IDS) as string[]).includes(value);
}

export function isImageSize(value: string): value is ImageSize {
  return (IMAGE_SIZES as readonly string[]).includes(value);
}

export function isImageAspectRatio(value: string): value is ImageAspectRatio {
  return (IMAGE_ASPECT_RATIOS as readonly string[]).includes(value);
}

export function normalizeImageSize(value: string): ImageSize | undefined {
  const normalized = value.toUpperCase();
  return isImageSize(normalized) ? normalized : undefined;
}

export function getImageModelSelection(value: ImageModelSelection | ImageModelId): ImageModelSelection {
  if (isImageModelSelection(value)) return value;
  return value === IMAGE_MODEL_IDS.flash ? 'flash' : 'pro';
}

export function getImageModelCapabilities(
  model?: ImageModelSelection | ImageModelId
): ImageModelCapabilities {
  return IMAGE_MODEL_CAPABILITIES[getImageModelSelection(model ?? DEFAULT_IMAGE_MODEL_SELECTION)];
}

export function isImageSizeSupportedByModel(
  model: ImageModelSelection | ImageModelId | undefined,
  imageSize: ImageSize
): boolean {
  return getImageModelCapabilities(model).supportedImageSizes.includes(imageSize);
}

export function isImageAspectRatioSupportedByModel(
  model: ImageModelSelection | ImageModelId | undefined,
  aspectRatio: ImageAspectRatio
): boolean {
  return getImageModelCapabilities(model).supportedAspectRatios.includes(aspectRatio);
}

export function getImageModelMaxReferenceImages(
  model?: ImageModelSelection | ImageModelId
): number {
  return getImageModelCapabilities(model).maxReferenceImages;
}
