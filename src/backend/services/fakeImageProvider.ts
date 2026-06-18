import type { ImageGenerationProvider } from './imageProvider';
import type {
  ComposeOptions,
  EditOptions,
  GenerateOptions,
  GenerationResult,
  ImageModel,
} from './nanoBananaService';
import { DEFAULT_IMAGE_MODEL_ID } from '../../shared/imageGenerationOptions';

const ONE_PIXEL_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

function resultFor(options: {
  model?: ImageModel;
  aspectRatio?: GenerationResult['aspectRatio'];
  imageSize?: GenerationResult['imageSize'];
}): GenerationResult {
  return {
    imageData: ONE_PIXEL_PNG,
    imageMimeType: 'image/png',
    model: options.model || DEFAULT_IMAGE_MODEL_ID,
    aspectRatio: options.aspectRatio,
    imageSize: options.imageSize,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    },
  };
}

export class FakeImageProvider implements ImageGenerationProvider {
  async generate(options: GenerateOptions): Promise<GenerationResult> {
    return resultFor(options);
  }

  async edit(options: EditOptions): Promise<GenerationResult> {
    return resultFor(options);
  }

  async compose(options: ComposeOptions): Promise<GenerationResult> {
    return resultFor(options);
  }
}
