# Video Playbook: Keyframes First, Then Direct The Shot

Make Effects generates video on Google's Veo 3.1 family
(`veo-3.1-generate-preview` by default, plus `-fast-` and `-lite-` variants). The
biggest lever on quality and consistency is upstream of Veo: **make your
keyframes as images first, then hand them to Veo as references.** Text-to-video
from a cold prompt is the least controllable path; image-to-video from locked
keyframes is the most.

## Generate The Keyframes, Then Animate Them

Veo 3.1 is built to consume reference images. Google calls the feature
"Ingredients to Video" — "maintain consistent characters, objects, and styles
across multiple shots by providing reference images" — and the documented
workflow is explicitly cross-model: generate character and setting references in
the image model, then feed them into Veo.[^gcloud-veo] That is exactly the Make
Effects pattern: build keyframes with `generate`/`derive`, then `video derive`
from those variant IDs.

```bash
# 1. Build a locked keyframe as an image (see the image playbook)
makefx derive --refs CHARACTER_VARIANT_ID,BACKGROUND_VARIANT_ID \
  --name "Shot 001 Keyframe" --type scene \
  "Hero centered in the market, cinematic 16:9 composition" \
  -o keyframes/shot-001.png

# 2. Animate the keyframe with Veo, attaching production metadata
makefx video derive --refs KEYFRAME_VARIANT_ID \
  --name "Episode 01 Shot 001" --type animation \
  --production-id episode-01 --shot-id shot-001 \
  --scene-label "Market" --timeline-start-ms 0 --duration-ms 8000 \
  "Slow dolly-in, subtle crowd movement, keep the hero centered" \
  -o video/episode-01/shot-001.mp4
```

Because the keyframe pins identity and composition, Veo only has to solve the
motion. This is also how you keep one character recognisable across many shots:
every shot derives from keyframes that share the same character sheet.

> Veo's first-and-last-frame interpolation (animate between two stills with a
> described camera move) and scene extension are powerful when you need a precise
> camera arc or a guaranteed start/end state.[^gcloud-veo] Track whether the
> Make Effects video surface exposes them yet in
> [model-and-parameter-selection.md](../model-and-parameter-selection.md); the
> keyframe-first principle applies regardless.

## Write A Prompt That Actually Directs The Shot

Use the five-part formula **Cinematography + Subject + Action + Context + Style
& Ambiance**, aim for roughly 100–200 words, and speak in real film vocabulary.
The shot type and camera move are not garnish: if you omit them, Veo defaults to
the most common framing it saw in training.[^deepmind-veo][^gcloud-veo]

```text
Medium shot, a tired corporate worker, rubbing his temples in exhaustion, in
front of a bulky 1980s computer in a cluttered office late at night. Lit by harsh
fluorescent overhead light and the green glow of a monochrome monitor. Retro
aesthetic, shot as if on 1980s color film, slightly grainy.
```

Reach for precise terms that Veo measurably rewards:[^deepmind-veo][^leonardo]

- **Camera movement:** dolly, tracking, crane, steadicam, POV, slow pan.
- **Composition:** wide shot, medium shot, close-up, low angle, two-shot.
- **Lens and focus:** shallow depth of field, wide-angle, macro, deep focus.
- **Lighting and grade:** golden hour, rim lighting, harsh fluorescent, muted teal.

Two rules carry over from the image playbook. **Use positive framing** — "a
desolate landscape with no buildings or roads" reads better than "no man-made
structures."[^gcloud-veo] And **describe what should be heard**: Veo generates
synchronized audio, but only if you ask for it (see the
[audio playbook](./audio.md)).

## Choreograph Multi-Beat Shots With Timestamps

For a sequence with distinct beats inside one clip, tag each beat with a time
range — **timestamp prompting** — to get cinematic pacing in a single
generation:[^gcloud-veo]

```text
[00:00-00:02] Medium shot from behind an explorer pushing aside a jungle vine.
[00:02-00:04] Reverse shot of her face, awe at moss-covered ruins. SFX: distant bird calls.
[00:04-00:06] Tracking shot as she runs a hand over ancient carvings.
[00:06-00:08] Wide crane shot revealing the vast temple. A gentle orchestral score swells.
```

Match this to the clip length you request — Veo 3.1 clips are short (commonly 4,
6, or 8 seconds), so keep the beat count honest. Pick the model variant for the
job: the default `generate` model for hero shots, `fast`/`lite` for cheaper
iteration and background motion. Details and defaults live in
[model-and-parameter-selection.md](../model-and-parameter-selection.md).

## Hand Off To A Renderer

When a clip is destined for a timeline, attach production metadata
(`--production-id`, `--shot-id`, `--scene-label`, `--timeline-start-ms`,
`--duration-ms`) at generation time, then export the whole production as
renderer-ready scene arguments:

```bash
makefx productions export --production-id episode-01 -o handoff/episode-01.scenes.args
```

This downloads the media through your authenticated session and emits sorted
`--scene '<startMs>|<label>|<path>'` arguments (use `--json` for structured
data). Keep variant IDs in your shotlist as the source of truth — not local
filenames. The full loop is in the
[CLI media production cookbook](../cli-media-production-cookbook.md).

## Quick Reference

| Goal | Do this |
|-|-|
| Consistent character across shots | Derive every shot from keyframes built on one character sheet |
| Controlled motion | `video derive --refs KEYFRAME_ID`, describe the camera move |
| A directed shot | Cinematography + Subject + Action + Context + Style, ~100–200 words |
| Multi-beat clip | Timestamp prompting, matched to a 4/6/8s clip |
| Cheaper iteration | Use the `fast` / `lite` Veo variant |
| Timeline handoff | Add production metadata, then `productions export` |

## Sources

[^deepmind-veo]: Google DeepMind. "How to create effective prompts with Veo 3." https://deepmind.google/models/veo/prompt-guide/
[^gcloud-veo]: Google Cloud (2025). "Ultimate prompting guide for Veo 3.1." https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-veo-3-1
[^leonardo]: Leonardo.Ai. "Veo 3 Prompt Guide – Tips & Examples." https://leonardo.ai/news/mastering-prompts-for-veo-3
