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
`src/backend/services/nanoBananaService.ts`.

### Model

Two models, selected via `'pro' | 'flash'` (`IMAGE_MODEL_CAPABILITIES`):

| Selection | Model ID | Use for | Key limit | Exposure |
|-|-|-|-|-|
| `pro` (default) | `gemini-3-pro-image-preview` | Production assets, any composition, multi-reference work | Up to 14 reference images | Web + top-level image CLI |
| `flash` | `gemini-2.5-flash-image` | Fast single-reference iteration, drafts | **Only 1 reference image** | Web + top-level image CLI |

**Default to Pro.** The default model is `gemini-3-pro-image-preview`
(`DEFAULT_IMAGE_MODEL_ID`) when a request does not set `recipe.model`;
image recipes leave it unset unless a web or CLI request selects a model. The
service throws if you pass more than one reference to Flash, and throws past 14
references on Pro.

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

Each reference `ImageInput` supports an optional `label`
used to build structured prompts ("Image 1:",
"Character:") — this is what powers role-assigned composition in the
[image playbook](./playbooks/images.md).

### Decision Table — Images

| Situation | Model | Size |
|-|-|-|
| Final hero asset, multiple references | `pro` | `2K`–`4K` |
| Quick draft, one or no reference | `flash` | `1K` |
| Character turnaround / tile set | `pro` (pipeline-driven) | `1K`–`2K` |
| Combining character + style + background | `pro` (needs >1 ref) | match output |

## Video (Veo 3.1)

Backed by `src/backend/services/googleVeoService.ts`.

### Audio

Video generation is silent by default. The web toggle and CLI `--audio` flag set
`generateAudio: true` in the variant recipe and workflow input, which requests
Veo-native synchronized dialogue, SFX, score, or ambience for that clip. CLI
`--no-audio` and omitted values set or normalize to `false`.

### Model Tier

The web tray and CLI expose Veo tier as `generate`, `fast`, or `lite`.
Internally these map to:

| Model ID | Use for | Exposure |
|-|-|-|
| `veo-3.1-generate-preview` (default) | Hero shots, final clips | `generate` tier |
| `veo-3.1-fast-generate-preview` | Cheaper, faster iteration | `fast` tier |
| `veo-3.1-lite-generate-preview` | Cheapest drafts, background motion tests | `lite` tier |

### Resolution And Duration

The web tray and CLI expose `720p`, `1080p`, or `4k` resolution and `4`, `6`,
or `8` second provider duration. CLI `--duration-ms` remains production
timeline metadata and does not replace the provider duration control. The
`lite` tier supports `720p` and `1080p`; use `generate` or `fast` for `4k`.

### Aspect Ratio

`VideoAspectRatio` (`googleVeoService.ts:15`): `16:9` (default) or `9:16` only —
narrower than the image set. Anything else normalizes to `16:9`
(`normalizeAspectRatio`, `:74`).

### Resolution

`VideoResolution` (`googleVeoService.ts:16`): `720p` (default), `1080p`, `4k`.
The web tray and CLI `--resolution` flag expose all three values, with `4k`
limited to the `generate` and `fast` tiers.

### Duration

`VideoDurationSeconds` (`googleVeoService.ts:17`): `4`, `6`, or `8` seconds,
default `8`. The web tray and CLI `--duration` flag expose all three values.
This is a provider duration control, not the `--duration-ms` CLI flag, which
records intended production-scene duration as metadata and is never passed to
Veo (`cli-generation.md:209`).

### Reference Modes

References are passed as `sourceImages`, and the stored recipe records the Veo
request mode. With no source images, Make Effects uses text-to-video. With one
unstyled source image, it uses Veo's image-to-video `image` input. With two
unstyled source images, it uses first/last-frame interpolation: the first image
is the starting frame and the second image is `lastFrame`. If active style
images are present, or if more than two source images remain, it uses Veo
reference images typed STYLE or ASSET by position (`getReferenceType`,
`googleVeoService.ts:89`). In practice: disable style when you need exact
first/last-frame interpolation.

Veo is not at parity with the image models here: video generation supports at
most **3** source/reference images (`googleVeoService.ts:140`), while Pro image
generation supports up to 14. When exactly one source image is supplied and no
style image is prepended, the service sends it through Veo's image-to-video
`request.image` path instead of `config.referenceImages` (`googleVeoService.ts:170`).

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
provider-specific configuration.

| Mode | Default model | Override | CLI |
|-|-|-|-|
| `speech` | `eleven_multilingual_v2` (`:427`) | `modelId` | `makefx audio speech generate` |
| `dialogue` | `eleven_v3` (`:427`) | `modelId` | `makefx audio dialogue generate` |
| `music` | `music_v1` (`:114`) | `modelId` | `makefx audio music generate` |
| `music` with Lyria | `lyria-3-clip-preview` | `LYRIA_MODEL_ID` | `makefx audio music generate --provider lyria` |
| `sfx` | `eleven_text_to_sound_v2` (`:115`) | `modelId` | `makefx audio sfx generate` |

### Voices

- **Speech** requires a configured `voiceId` (`:37`, validated at call time,
  `:174`). Generation uses the timestamped text-to-speech endpoint.
- **Dialogue** maps speakers to `dialogueVoiceIds` (`:38`) and parses prompts in
  `Speaker: line` form. Keep speaker names stable across files so a character
  keeps one voice.
- The connected account's voice library backs the UI picker (`listVoices`,
  `:71`). Treat a chosen voice as a locked reference asset — see the
  [audio playbook](./playbooks/audio.md).

### Decision Table — Audio

| Need | Mode | Notes |
|-|-|-|
| Narration / voiceover | `speech` | Requires `voiceId` |
| Multi-speaker scene | `dialogue` | `Speaker:` lines + `dialogueVoiceIds` |
| Bed, cue, sting | `music` | Brief genre/era/tempo/instruments/dynamics |
| Discrete effect | `sfx` | Describe the sound; tie to on-screen action for video |

## Audio (Gemini-Native And Future Models)

- **Veo native audio.** Veo 3.1 can score synchronized dialogue, SFX, and
  ambience alongside the video. In Make Effects this requires per-request
  `generateAudio: true` (`--audio` in the CLI or the web video audio toggle)
  plus a prompt audio layer that describes what should be heard. Requesting it
  does not reduce video resolution. See the [audio playbook](./playbooks/audio.md)
  for the prompt grammar.
- **Lyria** is the dedicated music model: genre/era, tempo, instruments,
  dynamics, plus image- or lyrics-based prompts. Watch version differences —
  negative prompts are supported on Lyria 2 but not Lyria 3.

Prompt grammar and references for both live in the
[audio playbook](./playbooks/audio.md).

## Sources

- Google DeepMind, [Gemini image prompt guide](https://deepmind.google/models/gemini-image/prompt-guide/), [Veo prompt guide](https://deepmind.google/models/veo/prompt-guide/), [Lyria prompt guide](https://deepmind.google/models/lyria/prompt-guide/).
- Google Cloud, [Ultimate prompting guide for Nano Banana](https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-nano-banana) and [for Veo 3.1](https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-veo-3-1).
- Service code: `nanoBananaService.ts`, `googleVeoService.ts`, `elevenLabsAudioProvider.ts`.
