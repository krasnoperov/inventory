# CLI Reference

The `makefx` CLI is the agent-friendly control surface for Make Effects.

It can create spaces, bind a local project, generate media, upload files, inspect website assets, watch real-time events, curate variants, and export production handoff data.

## Install

```sh
npm install -g makefx
```

## Authentication

```sh
makefx login
makefx logout
```

Use `--env stage` for staging or `--local` for local development.

## Spaces

```sh
makefx spaces
makefx spaces --details
makefx spaces create "My Game Assets" --init
makefx init --space YOUR_SPACE_ID
```

`makefx init` writes `.inventory/config.json` so future commands can omit `--space` and `--env`.

## Image generation

```sh
makefx generate "A market background" \
  --name "Market" \
  --type scene \
  -o art/market.png

makefx refine \
  --variant VARIANT_ID \
  "make it evening, warmer lights" \
  -o art/market-evening.png

makefx derive \
  --refs CHARACTER_VARIANT_ID,BACKGROUND_VARIANT_ID \
  --name "Hero in Market" \
  --type scene \
  "Place the hero naturally in the market" \
  -o art/hero-market.png
```

## Audio generation

```sh
makefx audio speech generate "Welcome to the forge." \
  --name "Intro Narration" \
  -o audio/intro.wav

makefx audio dialogue generate --input scripts/dialogue.txt \
  --name "Blacksmith Dialogue" \
  -o audio/blacksmith.wav

makefx audio music batch "Three 20 second low-intensity dungeon music beds" \
  --name "Dungeon Bed" \
  --count 3 \
  --output-dir audio/dungeon

makefx audio sfx generate "A crisp inventory item pickup sound effect" \
  --name "Item Pickup" \
  -o audio/pickup.wav
```

## Video generation

```sh
makefx video generate "A looping idle animation" \
  --name "Idle Animation" \
  --type animation \
  -o video/idle.mp4

makefx video refine \
  --variant VIDEO_VARIANT_ID \
  "make the motion snappier" \
  -o video/idle-snappy.mp4

makefx video derive \
  --refs IMAGE_VARIANT_ID,VIDEO_VARIANT_ID \
  --name "Attack Animation" \
  --type animation \
  "animate the pose into a short attack" \
  -o video/attack.mp4
```

## Assets and variants

```sh
makefx assets
makefx assets --json
makefx assets show ASSET_ID --json
makefx assets download VARIANT_ID -o references/variant.png

makefx assets rename ASSET_ID "Hero Character"
makefx assets set-active ASSET_ID VARIANT_ID
makefx variants retry VARIANT_ID
makefx variants star VARIANT_ID
makefx variants rate VARIANT_ID approved
```

## Live events

```sh
makefx listen --space YOUR_SPACE_ID
makefx listen --space YOUR_SPACE_ID --json
```

Use `listen` when an agent needs to monitor jobs, collaboration events, or variant status changes in real time.

## Run manifests

```sh
makefx runs --debug
makefx runs show --latest --debug --json
makefx runs export --latest --debug --format media -o media-run.json
```

Run manifests are local debug traces. They are useful for automation logs and recovery, but the website remains canonical.

## Agent guidance

- Prefer `--json` when available.
- Bind the project once with `makefx init`.
- Use variant IDs for existing website media.
- Use local image refs only when you want Make Effects to upload them into the space first.
- Use `listen --json` for long-running orchestration.
- Do not read or write Cloudflare storage directly from agents.

