# Model & Parameter Selection

Use this page to choose the model path and settings you can actually control from `makefx` today, plus the service defaults Make Effects uses for controls that are not public CLI flags. For prompting strategy, start with [Media Playbooks](/docs/media-playbooks).

## Images

Make Effects routes image jobs through Google models.

| Choice | Use for | Notes |
|-|-|-|
| Pro image model | assets you expect to reuse, compare, or hand off | public generation default; supports up to 14 references |
| Fast image model | quick drafts with one reference or no reference | service/internal path; not a public CLI flag today |

### Image parameters

| Parameter | Values | Guidance |
|-|-|-|
| Aspect ratio | `1:1`, `16:9`, `9:16`, `2:3`, `3:2`, `3:4`, `4:3`, `4:5`, `5:4`, `21:9` | choose for destination; default image generation is square when omitted |
| Reference images | Pro supports up to 14; Fast supports 1 | label each reference by role |
| Operation | `generate`, `refine`, `derive` | generate from text, edit an existing variant, or compose from references |

Use `16:9` or `21:9` for keyframes and backgrounds, `9:16` for vertical clips, `1:1` for icons and tiles, and portrait ratios for character cards.

## Video

Make Effects routes video jobs through Google's Veo family. The public CLI lets you set prompt, references, aspect ratio, and production metadata; model, resolution, and provider clip duration use server defaults today.

| Choice | Use for |
|-|-|
| default/generate model | clips you expect to review, place on a timeline, or ship |
| fast model | service-level cheaper iteration path |
| lite model | service-level draft path |

### Video parameters

| Parameter | Values | Guidance |
|-|-|-|
| Aspect ratio | `16:9`, `9:16` | other values normalize to landscape behavior |
| Resolution | server default is currently `720p` | not a public CLI flag today |
| Provider duration | server default is currently 8 seconds | not controlled by `--duration-ms` |
| References | up to 3 source images/keyframes | use keyframes to preserve identity and composition |

The CLI `--duration-ms` flag records where the clip fits on your production timeline. It does not guarantee the generated clip length.

## Audio

Choose one audio mode for each request.

| Mode | Default use | CLI |
|-|-|-|
| `speech` | one narrator or voiceover | `makefx audio speech generate` |
| `dialogue` | multi-speaker script | `makefx audio dialogue generate` |
| `music` | bed, cue, sting, loop | `makefx audio music generate` |
| `sfx` | one-off sound effect | `makefx audio sfx generate` |

Speech and dialogue depend on voice selection and provider configuration. Treat the voice as a reusable reference for identity. Production can use ElevenLabs; stage and local environments may use fake providers. Entitlement, quota, and rate checks can stop image, video, or audio generation before a provider call is made.

## Decision tables

### Images

| Situation | Pick |
|-|-|
| final asset with several references | Pro image path |
| quick draft with one reference | Fast image path |
| character turnaround or tile set | Pro image path |
| character plus style plus background | Pro image path |

### Video

| Situation | Pick |
|-|-|
| final shot from a keyframe | default/generate model with server defaults |
| quick motion test | fast or lite service path when exposed by the operator |
| vertical social clip | vertical aspect ratio |

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
