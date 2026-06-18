# Model & Parameter Selection

Use this page to choose the model path and settings you can actually control
from `makefx` today. For prompting strategy, start with
[Media Playbooks](/docs/media-playbooks).

## Images

Make Effects routes image jobs through Google's Nano Banana image models and
stores the exact provider model ID in each generated image recipe.

| Selection | Exact model ID | Use for | Notes |
|-|-|-|-|
| `pro` | `gemini-3-pro-image-preview` | assets you expect to reuse, compare, or hand off | default; supports up to 14 references |
| `flash` | `gemini-2.5-flash-image` | quick drafts with one reference or no reference | supports 1 reference and `1K` output only |

### Image parameters

| Parameter | Values | Guidance |
|-|-|-|
| Aspect ratio | `1:1`, `16:9`, `9:16`, `2:3`, `3:2`, `3:4`, `4:3`, `4:5`, `5:4`, `21:9` | choose for destination; default image generation is square when omitted |
| Image size | `1K`, `2K`, `4K` | Pro supports all three; Flash supports `1K` only |
| Reference images | Pro supports up to 14; Flash supports 1 | label each reference by role |
| Operation | `generate`, `refine`, `derive` | generate from text, edit an existing variant, or compose from references |

Use `16:9` or `21:9` for keyframes and backgrounds, `9:16` for vertical clips, `1:1` for icons and tiles, and portrait ratios for character cards.

## Video

Make Effects routes video jobs through Google's Veo 3.1 family. The public CLI
lets you set prompt, references, resolution, provider duration, model tier,
audio, and production metadata.

| Tier | Exact model ID | Use for |
|-|-|-|
| `generate` | `veo-3.1-generate-preview` | clips you expect to review, place on a timeline, or ship |
| `fast` | `veo-3.1-fast-generate-preview` | cheaper iteration path |
| `lite` | `veo-3.1-lite-generate-preview` | draft path for background motion tests |

### Video parameters

| Parameter | Values | Guidance |
|-|-|-|
| Aspect ratio | `16:9`, `9:16` | other values normalize to landscape behavior |
| Resolution | `720p`, `1080p`, `4k` | pick `720p` for tests; `4k` requires the generate or fast tier |
| Provider duration | `4`, `6`, `8` seconds | not controlled by `--duration-ms`; use CLI `--duration` or the web duration control |
| Tier | `generate`, `fast`, `lite` | use `generate` for final clips, `fast`/`lite` for iteration |
| References | up to 3 source images/keyframes | one unstyled image uses image-to-video; two unstyled images use first/last frames; any style image or 3 images uses reference-image mode |

The CLI `--duration-ms` flag records where the clip fits on your production timeline. It does not set the generated clip length; use `--duration 4|6|8` for provider duration.

## Audio

Choose one audio mode for each request.

| Mode | Default use | CLI |
|-|-|-|
| `speech` | one narrator or voiceover | `makefx audio speech generate` |
| `dialogue` | multi-speaker script | `makefx audio dialogue generate` |
| `music` | bed, cue, sting, loop | `makefx audio music generate` |
| `sfx` | one-off sound effect | `makefx audio sfx generate` |

Speech and dialogue depend on voice selection and provider configuration. Treat
the voice as a reusable reference for identity. Production can use ElevenLabs;
music requests may opt into Lyria with `--provider lyria`. Stage and local
environments may use fake providers. Entitlement, quota, and rate checks can
stop image, video, or audio generation before a provider call is made.

| Mode | Exact default model |
|-|-|
| `speech` | `eleven_multilingual_v2` |
| `dialogue` | `eleven_v3` |
| ElevenLabs `music` | `music_v1` |
| Lyria `music` | `lyria-3-clip-preview` |
| `sfx` | `eleven_text_to_sound_v2` |

## Provider reference semantics

Image generation requires references that resolve to completed image variants.
Zero image references calls Gemini text-to-image, one-reference `refine` calls
Gemini edit, and derive or multi-reference refine calls Gemini compose.
Reference labels such as `Image 1:` or `Style ref 1:` are included in prompt
text; they are not typed provider channels.

Video references use Veo-specific channels. Zero images is text-to-video. One
unstyled image is sent as the top-level image input. Two unstyled images use
first/last-frame interpolation. Any style image, or three final image inputs,
uses Veo `referenceImages[]`; style images are typed as provider `STYLE`, and
the remaining references are typed as `ASSET`.

Audio generation does not accept image references today. Voice IDs and ordered
dialogue voice selections are the reference-like controls for speech and
dialogue identity.

## Decision tables

### Images

| Situation | Pick |
|-|-|
| final asset with several references | `pro` image model |
| quick draft with one reference | `flash` image model |
| character turnaround or tile set | `pro` image model |
| character plus style plus background | `pro` image model |

### Video

| Situation | Pick |
|-|-|
| final shot from a keyframe | generate tier, 1080p or 4k, 8s |
| quick motion test | fast or lite tier, 720p, 4s or 6s |
| vertical social clip | generate tier, vertical aspect ratio, 6s or 8s |

### Audio

| Situation | Pick |
|-|-|
| narration | `speech` |
| character conversation | `dialogue` |
| background bed | `music` |
| event sound | `sfx` |

## Controls you can set

Start with these controls when shaping output:

- `--aspect` for image/video shape where supported
- `--count` for batches
- audio mode subcommands
- production metadata such as `--production-id`, `--shot-id`, `--scene-label`, `--timeline-start-ms`, and `--duration-ms`

If a control is not listed here, let Make Effects use its defaults and focus on prompt, references, aspect, count, and production metadata.
