# Model & Parameter Selection

How to choose models and parameters across the media stack. Values here are
taken from the service code, not just vendor docs — when the app normalizes or
constrains an input, that is called out with a `file:line` reference so this doc
stays honest as the code changes.

For *how to prompt* these models well, see the
[playbooks](./playbooks/README.md). This page is the *which knob, which value*
companion.

> **Service parameters vs. CLI flags.** The values below are the parameters the
> backend services accept. Top-level image CLI commands expose `--model`,
> `--size`, and `--aspect`; batch/count and production metadata have their own
> flags. Video CLI commands expose Veo resolution, provider duration, model
> tier, and native audio controls.
> See [cli-generation.md](./cli-generation.md) for the flag list.

## Images (Nano Banana)

Backed by `src/shared/imageGenerationOptions.ts` for model IDs and exact image
model capability limits, with provider enforcement in
`src/backend/services/nanoBananaService.ts`. Image recipes store the exact
provider model ID, not just the UI selection.

### Model

Two models, selected via `'pro' | 'flash'`
(`IMAGE_MODEL_IDS`, `src/shared/imageGenerationOptions.ts:4` and
`IMAGE_MODEL_CAPABILITIES`, `src/shared/imageGenerationOptions.ts:27`):

| Selection | Model ID | Use for | Key limit | Exposure |
|-|-|-|-|-|
| `pro` (default) | `gemini-3-pro-image-preview` | Production assets, any composition, multi-reference work | Up to 14 reference images | Web + top-level image CLI |
| `flash` | `gemini-2.5-flash-image` | Fast single-reference iteration, drafts | **Only 1 reference image** | Web + top-level image CLI |

**Default to Pro.** The default model is `gemini-3-pro-image-preview`
(`DEFAULT_IMAGE_MODEL_ID`, `src/shared/imageGenerationOptions.ts:10`) when a
request does not select a model, and image recipes persist that exact model ID
(`VariantFactory.resolveRecipeModel`, `src/backend/durable-objects/space/generation/VariantFactory.ts:968`).
The service throws if you pass more than one reference to Flash, and throws past
14 references on Pro (`validateImageModelReferenceLimit`,
`src/backend/durable-objects/space/generation/VariantFactory.ts:1001`).

### Aspect Ratio

`AspectRatio`: `1:1`, `16:9`, `9:16`, `2:3`, `3:2`,
`3:4`, `4:3`, `4:5`, `5:4`, `21:9`. Optional at the service boundary; Make
Effects generation currently defaults omitted image aspects to `1:1`; the web
Forge Tray also defaults its image aspect control to `1:1`. Set `--aspect`
explicitly in the CLI when you want anything else. Pick deliberately for the
destination: `16:9`/`21:9` for keyframes and backgrounds, `9:16` for
vertical/social, `1:1` for icons and tiles, `4:5` for portrait posts.

### Image Size

`ImageSize`: `1K`, `2K`, `4K`. Use `1K` for
iteration and thumbnails, step up to `2K`/`4K` only for final assets — higher
sizes cost more and are wasted on drafts you will regenerate. Flash is limited
to `1K`; the web UI disables larger sizes when Flash is selected and the CLI
rejects `--model flash --size 2K|4K`.

### Operations

Three operations map to the three CLI verbs:

| Operation | CLI | References | Notes |
|-|-|-|-|
| `generate` | `makefx generate` | none | Text to image |
| `edit` | `makefx refine` | the variant you edit | Conversational/semantic editing |
| `compose` | `makefx derive` | up to 14 (Pro) | Combine references into a new asset |

Provider API selection is reference-count driven. The workflow calls Gemini
`generate` with zero source images, `edit` only for a `refine` operation with
exactly one source image, and `compose` for derive or multi-reference refine
(`src/backend/workflows/GenerationWorkflow.ts:299`). Each reference
`ImageInput` supports an optional `label` used to build structured prompts
("Image 1:", "Character:") — this is prompt text for the provider, not a typed
provider reference channel.

### Decision Table — Images

| Situation | Model | Size |
|-|-|-|
| Final hero asset, multiple references | `pro` | `2K`–`4K` |
| Quick draft, one or no reference | `flash` | `1K` |
| Character turnaround / tile set | `pro` (pipeline-driven) | `1K`–`2K` |
| Combining character + style + background | `pro` (needs >1 ref) | match output |

## Video (Veo 3.1)

Backed by `src/shared/videoGenerationOptions.ts` for exact model IDs and
provider options, with request construction in
`src/backend/services/googleVeoService.ts`.

### Audio

Video generation defaults to generated audio. Current Veo/Gemini models do not
expose a separate audio toggle, so Make Effects rejects `generateAudio: false`
for those models instead of adding silent-video prompt text. Describe dialogue,
SFX, score, or ambience in the prompt when the sound track matters.

### Model Tier

The web tray and CLI expose Veo tier as `generate`, `fast`, or `lite`.
Internally these map to (`VIDEO_GENERATION_TIER_MODELS`,
`src/shared/videoGenerationOptions.ts:33`):

| Model ID | Use for | Exposure |
|-|-|-|
| `veo-3.1-generate-preview` (default) | Hero shots, final clips | `generate` tier |
| `veo-3.1-fast-generate-preview` | Cheaper, faster iteration | `fast` tier |
| `veo-3.1-lite-generate-preview` | Cheapest drafts, background motion tests | `lite` tier |

The default model is `veo-3.1-generate-preview`
(`DEFAULT_VIDEO_GENERATION_MODEL`, `src/shared/videoGenerationOptions.ts:23`).
The stored recipe keeps the tier plus the resolved model ID
(`VariantFactory.resolveRecipeVideoOptions`,
`src/backend/durable-objects/space/generation/VariantFactory.ts:914`).

### Resolution And Duration

The web tray and CLI expose `720p`, `1080p`, or `4k` resolution and `4`, `6`,
or `8` second provider duration. CLI `--duration-ms` remains production
timeline metadata and does not replace the provider duration control. The
`lite` tier supports `720p` and `1080p`; use `generate` or `fast` for `4k`.

### Aspect Ratio

`VideoAspectRatio` (`src/shared/videoGenerationOptions.ts:1`): `16:9`
(default) or `9:16` only — narrower than the image set. Anything else
normalizes to `16:9` in the workflow/service path.

### Resolution

`VideoResolution` (`src/shared/videoGenerationOptions.ts:2`): `720p`
(default), `1080p`, `4k`. The web tray and CLI `--resolution` flag expose all
three values, with `4k` limited to the `generate` and `fast` tiers
(`VIDEO_GENERATION_RESOLUTIONS_BY_TIER`,
`src/shared/videoGenerationOptions.ts:14`).

### Duration

`VideoDurationSeconds` (`src/shared/videoGenerationOptions.ts:3`): `4`, `6`,
or `8` seconds, default `8` (`src/shared/videoGenerationOptions.ts:21`). The
web tray and CLI `--duration` flag expose all three values. This is a provider
duration control, not the `--duration-ms` CLI flag, which records intended
production-scene duration as metadata and is never passed to Veo.

### Reference Modes

References are passed as `sourceImages`, and the stored recipe records the Veo
request mode (`veoReferenceMode`). The mode is inferred from the final resolved
image list after style injection (`determineVeoReferenceMode`,
`src/backend/services/googleVeoService.ts:98`):

| Final image inputs | Provider request shape | Stored mode |
|-|-|-|
| 0 images | prompt only | `text-to-video` |
| 1 image, no style image prepended | top-level `request.image` | `image-to-video` |
| 2 images, no style image prepended | top-level `request.image` plus `config.lastFrame` | `first-last-frame` |
| Any style image, or 3 images | `config.referenceImages[]` | `reference-images` |

When Veo uses `referenceImages[]`, Make Effects types prepended style images as
`STYLE` and all remaining images as `ASSET` by position (`getReferenceType`,
`src/backend/services/googleVeoService.ts:94`; request construction,
`src/backend/services/googleVeoService.ts:178`). In practice: disable style
when you need exact first/last-frame interpolation.

Veo is not at parity with image generation. Video generation accepts at most
**3** source/reference images (`GoogleVeoService.generate`,
`src/backend/services/googleVeoService.ts:144`). The variant factory caps video
references to the first three before workflow start, and caps style images to
whatever budget remains after user references
(`VariantFactory.capVeoSourceImageKeys`,
`src/backend/durable-objects/space/generation/VariantFactory.ts:1030`;
`injectStyle`,
`src/backend/durable-objects/space/generation/VariantFactory.ts:850`).

### Decision Table — Video

| Situation | Model | Resolution | Duration |
|-|-|-|-|
| Final hero shot from a keyframe | `generate` | `1080p` or `4k` | 8s |
| Quick motion test | `lite` / `fast` | `720p` | 4s or 6s |
| Vertical social clip | `generate` | `1080p` | 6s or 8s |

## Audio (ElevenLabs default, Lyria music optional)

Backed by `src/backend/services/elevenLabsAudioProvider.ts` and, for optional
music requests, `src/backend/services/lyriaMusicProvider.ts`. Audio uses
explicit **modes**; each resolves a default model you can override with
CLI `--model` for speech/dialogue or provider-specific configuration. Audio generation has no provider image
reference inputs today; voice IDs and dialogue speaker order are the only
reference-like controls.

| Mode | Default model | Override | CLI |
|-|-|-|-|
| `speech` | `eleven_v3` (`DEFAULT_SPEECH_MODEL`, `src/backend/services/elevenLabsAudioProvider.ts`) | CLI `--model`, then `modelId` | `makefx audio speech generate` |
| `dialogue` | `eleven_v3` (`DEFAULT_SPEECH_MODEL`, `src/backend/services/elevenLabsAudioProvider.ts`) | CLI `--model`, then `modelId` | `makefx audio dialogue generate` |
| `music` | `music_v1` (`DEFAULT_MUSIC_MODEL`, `src/backend/services/elevenLabsAudioProvider.ts:114`) | `modelId` | `makefx audio music generate` |
| `music` with Lyria | `lyria-3-clip-preview` (`DEFAULT_MODEL`, `src/backend/services/lyriaMusicProvider.ts:74`) | `LYRIA_MODEL_ID` | `makefx audio music generate --provider lyria` |
| `sfx` | `eleven_text_to_sound_v2` (`DEFAULT_SOUND_EFFECT_MODEL`, `src/backend/services/elevenLabsAudioProvider.ts:115`) | `modelId` | `makefx audio sfx generate` |

### Voices

- **Speech** requires a configured `voiceId`, validated at call time
  (`generateSpeech`, `src/backend/services/elevenLabsAudioProvider.ts:173`).
  Generation uses the timestamped text-to-speech endpoint.
- **Dialogue** maps speakers to `dialogueVoiceIds` by first appearance and
  parses prompts in `Speaker: line` form
  (`parseElevenLabsDialoguePrompt`,
  `src/backend/services/elevenLabsAudioProvider.ts:118`). Keep speaker names
  stable across files so a character keeps one voice.
- The connected account's voice library backs the UI picker (`listVoices`,
  `src/backend/services/elevenLabsAudioProvider.ts:71`). Treat a chosen voice
  as a locked reference asset — see the [audio playbook](./playbooks/audio.md).

### Decision Table — Audio

| Need | Mode | Notes |
|-|-|-|
| Narration / voiceover | `speech` | Requires `voiceId` |
| Multi-speaker scene | `dialogue` | `Speaker:` lines + `dialogueVoiceIds` |
| Bed, cue, sting | `music` | Brief genre/era/tempo/instruments/dynamics |
| Discrete effect | `sfx` | Describe the sound; tie to on-screen action for video |

## Provider Reference Semantics

Generation requests resolve same-space assets/variants into provider inputs
before the workflow starts. Explicit variant IDs win over asset IDs; asset IDs
resolve to their active variants
(`VariantFactory.resolveAllReferences`,
`src/backend/durable-objects/space/generation/VariantFactory.ts:1056`).
For image generation, every reference must resolve to a completed image. For
non-image generation, a media-only variant can still be recorded as a lineage
parent, but it is not passed as an image reference to the provider
(`resolveVariantReference`,
`src/backend/durable-objects/space/generation/VariantFactory.ts:1117`).

Style images are prepended ahead of user references, and the workflow labels
them as `Style ref N:` while user references are labeled `Image N:`
(`src/backend/workflows/GenerationWorkflow.ts:191`). For Gemini image
generation those labels are included in the text prompt. For Veo, the prepended
style count also controls whether images are typed as provider `STYLE` or
`ASSET` references.

The `fake` image/video provider preserves the same recipe and metadata shape
for local tests but does not call an external model. The optional `custom`
provider path applies only to image generation when `modelProvider: "custom"`
and `CUSTOM_MODEL_ENDPOINT` are configured
(`src/backend/workflows/GenerationWorkflow.ts:278`); video always uses Veo or
the fake provider, and audio uses the configured audio provider.

## Audio (Gemini-Native And Future Models)

- **Veo native audio.** Veo 3.1 can score synchronized dialogue, SFX, and
  ambience alongside the video. Make Effects defaults video requests to audio
  and rejects `generateAudio: false` for current Veo models because the Gemini
  API path has no real disable-audio switch. A prompt audio layer describes
  what should be heard. Audio does not reduce video resolution. See the
  [audio playbook](./playbooks/audio.md) for the prompt grammar.
- **Lyria** is the dedicated music model: genre/era, tempo, instruments,
  dynamics, plus image- or lyrics-based prompts. Watch version differences —
  negative prompts are supported on Lyria 2 but not Lyria 3.

Prompt grammar and references for both live in the
[audio playbook](./playbooks/audio.md).

## Sources

- Google DeepMind, [Gemini image prompt guide](https://deepmind.google/models/gemini-image/prompt-guide/), [Veo prompt guide](https://deepmind.google/models/veo/prompt-guide/), [Lyria prompt guide](https://deepmind.google/models/lyria/prompt-guide/).
- Google Cloud, [Ultimate prompting guide for Nano Banana](https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-nano-banana) and [for Veo 3.1](https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-veo-3-1).
- Service code: `nanoBananaService.ts`, `googleVeoService.ts`, `elevenLabsAudioProvider.ts`.
