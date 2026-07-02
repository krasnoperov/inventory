# Media Production Playbooks

Practical, reference-backed guidance for getting good results out of Make
Effects — building characters, style references, and scenes, then combining them
while keeping everything visually and tonally consistent.

These playbooks are the *why* and *how-to-prompt* companion to the technical
docs. Where a feature is described mechanically elsewhere (style presets,
rotation sets, the CLI), these pages explain how to use it well.

## Who These Are For

People and agents driving generation through the Make Effects app or the
`makefx` CLI. We assume you know the basic asset model (assets, variants,
lineage) from [domain.md](../domain.md) and can run a generation. You do not
need prior experience with diffusion models or prompt engineering.

## The Playbooks

| Playbook | Covers |
|-|-|
| [Images](./images.md) | Personages, style references, scenes, multi-reference composition, editing, consistency |
| [Video](./video.md) | Keyframes-first workflow, references ("ingredients"), cinematography prompts, iteration |
| [Audio](./audio.md) | Speech, dialogue, music, and SFX modes; the Gemini-native audio path |

## One Idea Behind All Three

Treat the model like a crew you brief in writing, not a slot machine. Across
images, video, and audio the same discipline produces consistent results:

1. **Lock identity once in a reference asset.** A character sheet for images,
   keyframes for video, a fixed voice or brief for audio. Reuse it everywhere.
2. **Name every reference explicitly.** Tell the model what each input is *for*
   — "Image A is the character, Image B is the style."
3. **Change one variable per turn.** Edit the pose, or the outfit, or the
   background — not all three — and check the result before the next step.

Make Effects already bakes these into product features: a space-level
[style](../style-and-batch.md) is injected into every request, and the
[rotation pipeline](../rotation-pipeline.md) feeds completed images forward as
references automatically. The playbooks show you how to lean on them.

## Sources

These playbooks cite current vendor and practitioner guidance. Full source list
lives at the bottom of each playbook. Primary references:

- Google DeepMind, [Gemini image prompt guide](https://deepmind.google/models/gemini-image/prompt-guide/) and [Veo prompt guide](https://deepmind.google/models/veo/prompt-guide/).
- Google Cloud, [Ultimate prompting guide for Nano Banana](https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-nano-banana) and [for Veo 3.1](https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-veo-3-1).
- Laurent Picard, [Generating Consistent Imagery with Gemini](https://towardsdatascience.com/generating-consistent-imagery-with-gemini/), Towards Data Science, September 2025.
