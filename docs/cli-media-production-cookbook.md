# CLI Media Production Cookbook

This cookbook shows an end-to-end production loop for agents or operators using
Make Effects CLI as the control surface for website-backed media generation. The
website remains the source of truth for spaces, assets, variants, lineage,
recipes, billing, and production placement records. Local downloaded files are
handoff artifacts. `.inventory/runs/*.json` files are debug-only traces and are
not production handoff state.

## Setup

Build the CLI, authenticate, and bind the current project directory to a space:

```bash
pnpm run build:cli
makefx login
makefx spaces create "Episode 01 Media" --init
```

For local provider-free verification, use:

```bash
pnpm run test:e2e:cli-forge
```

That loop starts a local worker with fake providers, creates a dev space, drives
image, audio, podcast, and video CLI commands, downloads artifacts, and checks
debug run exports without calling Gemini, ElevenLabs, or Veo.

## Production Loop

Use this loop for every media kind:

1. Inspect or create the target space.
2. Generate or upload source media.
3. Use website variant IDs as references for derived media.
4. Download completed outputs with `-o` or `--output-dir`.
5. Export Space-backed production records for timeline assembly.

Useful read-side commands:

```bash
makefx assets
makefx assets show ASSET_ID --json
makefx assets download VARIANT_ID -o references/source.png
```

## Images

Create a concept image, refine it, then derive a shot keyframe from website
variant references:

```bash
makefx generate \
  "A painterly town market background, warm morning light" \
  --name "Market Background" \
  --type scene \
  -o images/market-background.png

makefx refine \
  --variant BACKGROUND_VARIANT_ID \
  "Add shop signs, more foreground depth, keep the same camera angle" \
  -o images/market-background-v2.png

makefx derive \
  --refs CHARACTER_VARIANT_ID,BACKGROUND_VARIANT_ID \
  --name "Hero Market Keyframe" \
  --type scene \
  "Place the hero in the market, cinematic composition, 16:9 keyframe" \
  -o keyframes/hero-market-001.png
```

Use `batch` when the next step needs several candidate images:

```bash
makefx batch \
  "Four visual explorations for a rainy alley establishing shot" \
  --name "Rainy Alley Keyframe" \
  --type scene \
  --count 4 \
  --mode set \
  --output-dir keyframes/rainy-alley
```

## Audio

Audio commands use explicit modes. Use `speech` for narration, `dialogue` for
multi-speaker scripts, `music` for beds or cues, and `sfx` for sound effects:

```bash
makefx audio speech generate \
  "A calm host intro: Welcome back to the forge." \
  --name "Episode Intro Narration" \
  -o audio/intro.wav

makefx audio dialogue generate \
  --input scripts/scene-dialogue.txt \
  --name "Blacksmith Dialogue" \
  -o audio/blacksmith-dialogue.wav

makefx audio music batch \
  "Three 20 second low-intensity fantasy workshop music beds" \
  --name "Workshop Music Bed" \
  --count 3 \
  --output-dir audio/music-beds

makefx audio sfx generate \
  "A crisp inventory item pickup sound effect" \
  --name "Item Pickup SFX" \
  -o audio/item-pickup.wav
```

Dialogue script files should use one `Speaker: line` entry per line when the
server is configured for multi-speaker ElevenLabs dialogue.

## Video

Use image keyframes as references for video clips. Add production metadata when
the clip will be handed to a renderer:

```bash
makefx video derive \
  --refs KEYFRAME_VARIANT_ID \
  --name "Episode 01 Shot 001" \
  --type animation \
  --production-id episode-01 \
  --shot-id shot-001 \
  --scene-label "Market" \
  --timeline-start-ms 0 \
  --duration-ms 8000 \
  "Slow dolly-in, subtle crowd movement, keep the hero centered" \
  -o video/episode-01/shot-001.mp4

makefx video refine \
  --variant VIDEO_VARIANT_ID \
  --production-id episode-01 \
  --shot-id shot-001b \
  --scene-label "Market" \
  --timeline-start-ms 0 \
  --duration-ms 8000 \
  "Make the camera movement smoother and reduce background motion" \
  -o video/episode-01/shot-001b.mp4

makefx productions export \
  --production-id episode-01 \
  -o handoff/episode-01.scenes.args
```

`productions export` downloads image and video media from Space through the
authenticated CLI session and outputs sorted shell-ready scene arguments in the
shape `--scene '<startMs>|<label>|<absolute-media-path>'`. Use `--json` when a
renderer or agent wants structured scene data instead.

## Podcasts

Podcast production uses the same audio primitives plus optional image and video
assets for cover art or social clips:

```bash
makefx generate \
  "Square cover art for a game development podcast, clean readable shapes" \
  --name "Podcast Cover Art" \
  --type scene \
  -o podcast/cover.png

makefx audio speech generate \
  --input scripts/podcast-intro.txt \
  --name "Podcast Intro" \
  -o podcast/intro.wav

makefx audio dialogue generate \
  --input scripts/podcast-conversation.txt \
  --name "Podcast Conversation" \
  -o podcast/conversation.wav

makefx audio music generate \
  "A 12 second upbeat synth podcast sting, no vocals" \
  --name "Podcast Sting" \
  -o podcast/sting.wav
```

For a social promo, derive a video from the cover or a generated keyframe and
export it with production metadata:

```bash
makefx video derive \
  --refs COVER_VARIANT_ID \
  --name "Podcast Social Promo" \
  --type animation \
  --production-id podcast-episode-01 \
  --shot-id promo-001 \
  --scene-label "Cover Loop" \
  --timeline-start-ms 0 \
  --duration-ms 12000 \
  "Animate the cover with subtle parallax and a clean title reveal" \
  -o podcast/social-promo.mp4

makefx productions export \
  --production-id podcast-episode-01 \
  -o podcast/social-promo.scenes.args
```

## Handoff Rules

- Keep variant IDs in scripts or shotlists; do not depend on local filenames as
  the source of truth.
- Use local image paths in `--refs` only when you want the CLI to upload them as
  visible reference assets first.
- Use `--force` only when replacing local downloads intentionally.
- Export `productions` records for timed image or video scene assembly.
- Use `makefx runs --debug` only when troubleshooting local CLI downloads
  or provider-free e2e behavior. Do not feed `.inventory/runs` into production
  assembly.
