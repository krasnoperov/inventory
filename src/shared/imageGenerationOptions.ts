export const IMAGE_MODEL_SELECTIONS = ['pro', 'flash'] as const;
export type ImageModelSelection = typeof IMAGE_MODEL_SELECTIONS[number];

export const IMAGE_MODEL_IDS = {
  pro: 'gemini-3-pro-image-preview',
  flash: 'gemini-2.5-flash-image',
} as const;
export type ImageModelId = typeof IMAGE_MODEL_IDS[ImageModelSelection];

export const IMAGE_ASPECT_RATIOS = ['1:1', '16:9', '9:16', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '21:9'] as const;
export type ImageAspectRatio = typeof IMAGE_ASPECT_RATIOS[number];

export const IMAGE_SIZES = ['1K', '2K', '4K'] as const;
export type ImageSize = typeof IMAGE_SIZES[number];

export function resolveImageModelSelection(selection?: ImageModelSelection): ImageModelId {
  return IMAGE_MODEL_IDS[selection ?? 'pro'];
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

export function normalizeImageSize(value: string): ImageSize | undefined {
  const normalized = value.toUpperCase();
  return isImageSize(normalized) ? normalized : undefined;
}
