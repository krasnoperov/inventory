# Model & Parameter Selection

How to choose models and parameters across the media stack. Values here are
taken from the service code, not just vendor docs — when the app normalizes or
constrains an input, that is called out with a `file:line` reference so this doc
stays honest as the code changes.

For *how to prompt* these models well, see the
[playbooks](./playbooks/README.md). This page is the *which knob, which value*
companion.

> **Service parameters vs. CLI flags.** The values below are the parameters the
> backend services accept. Not all are exposed as `makefx` CLI flags — the CLI
> surfaces `--aspect`, `--count`, `--mode`, and production-metadata flags such
> as `--duration-ms`. Model choice, image/video resolution, and Veo
> `durationSeconds` currently fall to server-side defaults. Where a value is set
> by a default rather than a flag, that is noted. Service-supported values that
> are **not yet exposed** are marked below; see the tracked exposure issues for
> image size 2K/4K ([INV-97](https://linear.app/usertold/issue/INV-97/image-generation-controls-model-size-aspect)),
> Veo resolution 1080p/4k ([INV-70](https://linear.app/usertold/issue/INV-70/expose-video-resolution-720p1080p4k-in-web-cli)),
> Veo duration 4/6/8s ([INV-84](https://linear.app/usertold/issue/INV-84/expose-video-duration-468s-fix-6s-chip-and-forced-8s-ux)),
> and Veo fast/lite tiers ([INV-73](https://linear.app/usertold/issue/INV-73/wire-up-and-expose-the-veo-tier-generatefastlite)).
> See [cli-generation.md](./cli-generation.md) for the flag list.

## Images (Nano Banana)

Backed by `src/backend/services/nanoBananaService.ts`.

### Model

Two models, selected via `'pro' | 'flash'` (`resolveImageModel`,
`nanoBananaService.ts:51`):

| Selection | Model ID | Use for | Key limit | Exposure |
|-|-|-|-|-|
| `pro` (default) | `gemini-3-pro-image-preview` | Production assets, any composition, multi-reference work | Up to 14 reference images | Server default today |
| `flash` | `gemini-2.5-flash-image` | Fast single-reference iteration, drafts | **Only 1 reference image** (`nanoBananaService.ts:202`) | Service/internal path; not yet exposed as a model control |

**Default to Pro.** The default model is `gemini-3-pro-image-preview`
(`nanoBananaService.ts:119`). Flash is service-supported for cases that need
speed and at most one reference, but public image model selection is not exposed
yet (tracked by
[INV-97](https://linear.app/usertold/issue/INV-97/image-generation-controls-model-size-aspect)).
The service throws if you pass more than one reference to Flash, and throws past
14 references on either model (`nanoBananaService.ts:202`, `:206`).

### Aspect Ratio

`AspectRatio` (`nanoBananaService.ts:47`): `1:1`, `16:9`, `9:16`, `2:3`, `3:2`,
`3:4`, `4:3`, `4:5`, `5:4`, `21:9`. Optional at the service boundary; Make
Effects generation currently defaults omitted image aspects to `1:1`
(`GenerationWorkflow.ts:245`), so set `--aspect` explicitly when you want
anything else. Pick deliberately for the destination: `16:9`/`21:9` for keyframes
and backgrounds, `9:16` for vertical/social, `1:1` for icons and tiles, `4:5` for
portrait posts.

### Image Size

`ImageSize` (`nanoBananaService.ts:48`): `1K`, `2K`, `4K`. Optional. Use `1K`
for iteration and thumbnails, step up to `2K`/`4K` only for final assets — higher
sizes cost more and are wasted on drafts you will regenerate. `2K` and `4K` are
service-supported but **not yet exposed** as public web/CLI controls (tracked by
[INV-97](https://linear.app/usertold/issue/INV-97/image-generation-controls-model-size-aspect)).

### Operations

Three operations map to the three CLI verbs:

| Operation | CLI | References | Notes |
|-|-|-|-|
| `generate` | `makefx generate` | none | Text to image |
| `edit` | `makefx refine` | the variant you edit | Conversational/semantic editing |
| `compose` | `makefx derive` | up to 14 (Pro) | Combine references into a new asset |

Each reference `ImageInput` supports an optional `label`
(`nanoBananaService.ts:58`) used to build structured prompts ("Image 1:",
"Character:") — this is what powers role-assigned composition in the
[image playbook](./playbooks/images.md).

### Decision Table — Images

| Situation | Model | Size |
|-|-|-|
| Final hero asset, multiple references | `pro` | `2K`–`4K` when exposed; service-only today |
| Quick draft, one or no reference | `flash` when exposed; Pro/default today | `1K` |
| Character turnaround / tile set | `pro` (pipeline-driven) | `1K`–`2K` when exposed |
| Combining character + style + background | `pro` (needs >1 ref) | match output |

## Video (Veo 3.1)

Backed by `src/backend/services/googleVeoService.ts`.

### Model

Three variants (`googleVeoService.ts:10`), default `veo-3.1-generate-preview`
(`:58`):

| Model ID | Use for | Exposure |
|-|-|-|
| `veo-3.1-generate-preview` (default) | Hero shots, final clips | Server default today |
| `veo-3.1-fast-generate-preview` | Cheaper, faster iteration | Service-only / not yet exposed |
| `veo-3.1-lite-generate-preview` | Cheapest drafts, background motion tests | Service-only / not yet exposed |

Fast/lite tier exposure is tracked by
[INV-73](https://linear.app/usertold/issue/INV-73/wire-up-and-expose-the-veo-tier-generatefastlite).

### Aspect Ratio

`VideoAspectRatio` (`googleVeoService.ts:14`): `16:9` (default) or `9:16` only —
narrower than the image set. Anything else normalizes to `16:9`
(`normalizeAspectRatio`, `:69`).

### Resolution

`VideoResolution` (`googleVeoService.ts:15`): `720p` (default), `1080p`, `4k`.
Unrecognized values fall back to `720p` (`normalizeResolution`, `:79`). `1080p`
and `4k` are service-supported but **not yet exposed** as public web/CLI controls
(tracked by
[INV-70](https://linear.app/usertold/issue/INV-70/expose-video-resolution-720p1080p4k-in-web-cli)).

### Duration

`VideoDurationSeconds` (`googleVeoService.ts:16`): `4`, `6`, or `8` seconds,
default `8` (`:61`). **Two rules force 8 seconds** (`normalizeDuration`, `:73`,
called at `:113`):

- when any reference/source image is supplied, or
- when resolution is anything other than `720p`.

So a referenced or higher-resolution clip is always 8s. Plan your shot pacing
(and timestamp prompting) around the duration you will actually get.

This `durationSeconds` is a service parameter set by default today — it is **not**
the `--duration-ms` CLI flag, which records intended production-scene duration as
metadata and is never passed to Veo (`cli-generation.md:209`). Choosing 4/6/8s is
service-supported but **not yet exposed** as a public web/CLI control (tracked by
[INV-84](https://linear.app/usertold/issue/INV-84/expose-video-duration-468s-fix-6s-chip-and-forced-8s-ux)).

### Reference Images ("Ingredients")

References are passed as `sourceImages`. Each is typed STYLE or ASSET by position
— the first `styleImageCount` entries are treated as STYLE references, the rest
as ASSET references (`getReferenceType`, `googleVeoService.ts:84`). In practice:
space style images lead, your keyframes follow. This is the consistency
mechanism described in the [video playbook](./playbooks/video.md).

Veo is not at parity with the image models here: video generation supports at
most **3** source/reference images (`googleVeoService.ts:107`), while Pro image
generation supports up to 14. When exactly one source image is supplied and no
style image is prepended, the service sends it through Veo's image-to-video
`request.image` path instead of `config.referenceImages` (`googleVeoService.ts:135`).

### Decision Table — Video

| Situation | Model | Resolution | Duration |
|-|-|-|-|
| Final hero shot from a keyframe | `generate` | `1080p` when exposed; `720p` default today | 8s (forced) |
| Quick motion test | `lite` / `fast` when exposed; default today | `720p` | 4–8s when exposed; 8s default today |
| Vertical social clip | `generate` | `1080p` when exposed; `720p` default today | 8s |

## Audio (ElevenLabs, shipped)

Backed by `src/backend/services/elevenLabsAudioProvider.ts`. Audio uses explicit
**modes**; each resolves a default model you can override with `modelId`
(`:39`, `:246`).

| Mode | Default model | Override | CLI |
|-|-|-|-|
| `speech` | `eleven_multilingual_v2` (`:427`) | `modelId` | `makefx audio speech generate` |
| `dialogue` | `eleven_v3` (`:427`) | `modelId` | `makefx audio dialogue generate` |
| `music` | `music_v1` (`:114`) | `modelId` | `makefx audio music generate` |
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

## Audio (Gemini-native, target architecture)

Not shipped — documented so parameter choices line up when the app grows into it.

- **Veo native audio.** Veo 3.1 can score synchronized dialogue, SFX, and
  ambience alongside the video; audio is requested through the *prompt's audio
  layer*, not a separate model parameter. Requesting it does not reduce video
  resolution. See the [audio playbook](./playbooks/audio.md) for the prompt
  grammar.
- **Lyria** is the dedicated music model: genre/era, tempo, instruments,
  dynamics, plus image- or lyrics-based prompts. Watch version differences —
  negative prompts are supported on Lyria 2 but not Lyria 3.

Prompt grammar and references for both live in the
[audio playbook](./playbooks/audio.md).

## Sources

- Google DeepMind, [Gemini image prompt guide](https://deepmind.google/models/gemini-image/prompt-guide/), [Veo prompt guide](https://deepmind.google/models/veo/prompt-guide/), [Lyria prompt guide](https://deepmind.google/models/lyria/prompt-guide/).
- Google Cloud, [Ultimate prompting guide for Nano Banana](https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-nano-banana) and [for Veo 3.1](https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-veo-3-1).
- Service code: `nanoBananaService.ts`, `googleVeoService.ts`, `elevenLabsAudioProvider.ts`.
