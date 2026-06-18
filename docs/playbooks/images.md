# Image Playbook: Characters, Styles, Scenes, And Consistency

This is the long game of image generation: making a character you can use in
fifty pictures, a style that holds across a whole space, and scenes that combine
both without the model quietly redrawing your hero's face. Make Effects runs on
Google's Nano Banana image models (`gemini-3-pro-image-preview` by default,
`gemini-2.5-flash-image` for fast single-reference work), so the guidance here
follows Google's own prompting advice and the practitioner techniques built
around it.

If you only remember one thing: **consistency is an input problem, not a luck
problem.** You get it by building reference assets and naming them, not by
re-rolling the same prompt until it matches.

## Build A Character Before You Build A Picture

Spend your first generation making a reference asset, not a finished
illustration. The single most reliable technique across every credible guide is
the **character sheet** — a multi-view sheet (front, three-quarter, side, back)
generated once and then handed back to the model as a named reference in every
later prompt. Google DeepMind's guide is blunt about the mechanism: "Upload
clear reference images, and assign a distinct name to each character or object
in your prompt so the model can follow along."[^deepmind-image]

Laurent Picard's [worked example](https://towardsdatascience.com/generating-consistent-imagery-with-gemini/)
is the clearest end-to-end demonstration: extract the character cleanly, build a
labelled multi-view sheet on a pure-white background, then generate every later
scene by passing *both* the sheet and the previous frame, each labelled — "Image
1: character sheet. Image 2: previous scene" — so the model never has to guess
which character it is editing.[^picard]

**In Make Effects, you don't build the sheet by hand.** The
[rotation pipeline](../rotation-and-tiles.md) does it for you: seed it with one
strong variant, pick `turnaround` (front, 3/4-front, side, 3/4-back, back),
`4-directional`, or `8-directional`, and each step feeds every completed view
back as a reference for the next. The injected prompt literally instructs the
model to "show the EXACT SAME subject" and "maintain identical design,
proportions, colors, clothing, and style." That *is* the character-sheet
methodology, automated.

```bash
# Generate the seed character, then rotate it into a consistent sheet
makefx generate "A felt-craft robot explorer, small brown backpack, friendly" \
  --name "Robot Explorer" --type character -o characters/robot.png
# (then start a turnaround rotation from that variant in the app or CLI)
```

A few hard-won numbers from practitioner testing: use clean references of at
least 1024×1024, supply three to six angles, and cap a single request at roughly
six references for faces before structural accuracy starts to drift — even
though the model technically accepts more.[^laozhang] And skip the habit of
hunting for a "seed" to force identity; deterministic seed control is **not**
documented in the Gemini image API. Reuse the same references and constraints
across turns instead.[^rundiffusion]

## Style References: One Or Two Anchors, Applied Everywhere

A **style** is the look you want every asset to share — "pixel art, 16-bit,
vibrant colors," "soft watercolor," "matte 3D clay." Make Effects models this as
a first-class space feature: one [style](../style-and-batch.md) per space, with a
description plus up to five reference images, automatically prepended to every
generation request so nobody has to retype it. The style images go *first* in
the reference list, ahead of your per-prompt references.

The practitioner rule that matters here: **anchor to one or two styles, not
five.** Stacking conflicting aesthetics in a single prompt — "anime +
hyper-realistic + cartoon" — breaks continuity.[^chatsmith] A space-level style
keeps you honest by giving the whole space one coherent identity. When you need
a genuinely different look for one asset, set `disableStyle` on that request
rather than fighting the anchor with contradictory words.

When you want to *move* an existing image into a new look, treat **style
transfer as its own operation**: take the base image as a reference and ask for
it re-rendered in the target style (the canonical example is turning a city
street into a Van Gogh painting).[^gcloud-nb] In Make Effects that is a `refine`
or `derive` with the source variant as the reference and a style instruction in
the prompt — not a from-scratch `generate`.

## Scenes: A Prompt Skeleton That Works

Write every scene against a consistent five-part skeleton —
**Subject, Action, Location, Composition, Style** — as concrete description
rather than a pile of keywords. This component list appears almost verbatim
across Google DeepMind's image guide, the official Nano Banana Pro tips, and
Google Cloud's prompting guide.[^deepmind-image][^blog-nbpro][^gcloud-nb]

```text
[Subject]      A weathered dwarven blacksmith, broad shoulders, braided beard
[Action]       hammering a glowing blade on an anvil, sparks flying
[Location]     a dim stone forge, embers and hanging tools in the background
[Composition]  medium shot, low angle, shallow depth of field
[Style]        painterly fantasy illustration, warm rim lighting
```

Three rules sharpen the skeleton:

- **Prefer positive framing.** Describe an "empty street," not "no cars."
  Instructive negations like "no" and "don't" tend to misfire.[^gcloud-nb]
- **Control the camera with real vocabulary.** "Low angle," "85mm lens,"
  "shallow depth of field (f/1.8)," "golden hour backlighting" — Gemini reads
  these as genuine photographic intent, not decoration.[^gcloud-nb][^blog-nbpro]
- **Name materials precisely.** "Navy blue tweed" beats "jacket"; "ornate elven
  plate armor etched with silver leaf" beats "armor."[^gcloud-nb]

For text inside an image, put the exact words in quotation marks and describe
the typeface ("bold, white, sans-serif") — Nano Banana Pro renders sharp,
legible type across many languages.[^deepmind-image][^blog-nbpro]

## Combining References Without Bleed

When a scene needs a specific character *and* a specific background *and* a
specific style, upload each as a separate reference and **give every one an
explicit role in the prompt**: "Use Image A for the character, Image B for the
art style, Image C for the background." Google Cloud's composition grammar
captures it as `[References] + [Relationship instruction] + [New scenario]`, and
both Pro and Flash hold the resemblance of multiple characters even when they
appear together.[^gcloud-nb][^blog-nbpro]

Make Effects exposes this as `derive` with multiple `--refs`:

```bash
makefx derive \
  --refs CHARACTER_VARIANT_ID,BACKGROUND_VARIANT_ID \
  --name "Hero In Market" --type scene \
  "Place the character from the first reference into the market background from \
   the second reference. Cinematic 16:9 composition, keep the character's design \
   and colors exact." \
  -o keyframes/hero-market.png
```

Two ceilings to respect. The models accept up to **14 reference images**, and
Make Effects enforces this — when a space style is active, the
[Forge Tray](../style-and-batch.md) shrinks your slot count to `14 −
styleImageCount` so style plus your references never overflows. `gemini-2.5-flash-image`
accepts **only one** reference image, so reach for the Pro model whenever you are
composing.

## Edit One Thing At A Time

To change a finished image, use **conversational editing**: describe the change
*and* explicitly state what must stay the same. This is "semantic masking" — you
define the edit region in words instead of painting a mask, so everything you do
not mention is preserved.[^deepmind-image][^gcloud-nb] Lighting, textures, and
camera angle carry forward when you don't re-specify them, which makes silence a
consistency tool.[^picard]

```bash
makefx refine --variant BACKGROUND_VARIANT_ID \
  "Add hanging shop signs and more foreground depth. Keep the same camera angle, \
   lighting, and color palette." \
  -o images/market-v2.png
```

The discipline that separates clean results from drift is **one variable per
turn**: change the pose, or the outfit, or the background — never all three —
and verify before stacking the next edit. For long sequences (storyboards of
dozens of frames), this incrementalism plus a fixed reference sheet is what keeps
frame fifty recognisable as the same character from frame one.[^flowith]

## Scenes That Tile Or Rotate

Two production patterns get their own automated pipelines, both built on the
feed-forward reference idea:

- **Rotation sets** turn one subject into a consistent multi-angle sheet
  (covered above). Use them for character turnarounds and prop views.
- **Tile sets** grow a seamless map outward from a center tile using
  adjacency-aware prompting, spiralling from the middle so each new tile
  references its finished neighbours. Grids run 2×2 up to 5×5. See
  [rotation-and-tiles.md](../rotation-and-tiles.md).

Both exist precisely because feeding completed images back as references is what
holds a set together — the same reason the character-sheet method works.

## Quick Reference

| Goal | Do this |
|-|-|
| Reusable character | Build a rotation/turnaround sheet first, reuse as reference |
| Consistent space look | Set a space style (1 description + ≤5 images) |
| Different look, same subject | `refine`/`derive` with style instruction, not `generate` |
| Combine character + background | `derive --refs A,B`, name each reference's role |
| Small change to a finished image | `refine`, state what changes *and* what stays |
| Many references | Use the Pro model (Flash allows only 1); stay ≤14 total |

## Sources

[^deepmind-image]: Google DeepMind. "How to create effective image prompts with Nano Banana." https://deepmind.google/models/gemini-image/prompt-guide/
[^gcloud-nb]: Google Cloud (2025). "Ultimate prompting guide for Nano Banana." https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-nano-banana
[^blog-nbpro]: Google (2025). "Nano Banana Pro image generation in Gemini: Prompt tips." https://blog.google/products-and-platforms/products/gemini/prompting-tips-nano-banana-pro/
[^picard]: Picard, Laurent (2025, September 23). "Generating Consistent Imagery with Gemini." Towards Data Science. https://towardsdatascience.com/generating-consistent-imagery-with-gemini/
[^laozhang]: LaoZhang AI. "Nano Banana Pro Face Consistency: The Complete 2026 Guide." https://blog.laozhang.ai/en/posts/nano-banana-pro-face-consistency-guide
[^rundiffusion]: RunDiffusion. "How to Create Consistent Character Campaign Images With Nano Banana 2." https://www.rundiffusion.com/nano-banana-2-consistent-character-images
[^chatsmith]: ChatSmith. "Using Gemini Nano Banana to Create Consistent Characters in AI Images." https://chatsmith.io/blogs/ai-guide/using-gemini-nano-banana-consistent-characters-ai-images-00037
[^flowith]: Flowith. "How to Maintain Consistent Characters Across 50 Storyboard Frames with Nano Banana 2." https://flowith.io/blog/nano-banana-consistent-characters-storyboard/
