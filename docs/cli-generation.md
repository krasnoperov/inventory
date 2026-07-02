# CLI Forge Control

The CLI can drive an existing Make Effects space as a ForgeTray controller.
The website remains the source of truth: assets, variants, recipes, lineage, and
stored media live in the Space Durable Object and R2. The CLI sends requests,
waits for completion, and downloads local copies of completed media.
Top-level `generate`, `refine`, `derive`, and `batch` are image-only commands
and send `mediaKind: "image"` with generation requests. The `audio` subcommands
send `mediaKind: "audio"` and use the same website job lifecycle. The `video`
subcommands send `mediaKind: "video"` through the website job lifecycle. The
shared source of truth for these generation capabilities is
`src/shared/mediaOperationMatrix.ts`.

## Shared Operation Matrix

| CLI surface | Commands | Sent `mediaKind` | References | Run manifest |
|-------------|----------|------------------|------------|----------------|
| Top-level image | `generate`, `refine`, `derive`, `batch` | `image` | `derive --refs` and `batch --refs` accept completed image variant IDs or local image files | Yes |
| Audio namespace | `audio <speech|dialogue|music|sfx> generate`, `audio <speech|dialogue|music|sfx> batch` | `audio` | Not supported | Yes |
| Video namespace | `video generate`, `video refine`, `video derive` | `video` | `video derive --refs` accepts completed image/video variant IDs or local image files | Yes for single-output commands; video batch is not supported |

Forge Tray uses the same matrix for mode labels, output media kind, default
asset type, slot compatibility, batch/style controls, and operation selection.

## Project Binding

Bind a local directory to a website space:

```bash
makefx init --space SPACE_ID
```

This writes `.inventory/config.json` with the target environment and space ID.
It does not store assets, prompts, images, generation keys, or auth tokens.
Inside an initialized project, Forge commands can omit `--space` and `--env`.
Explicit command flags override the project config.

Without an initialized project or explicit `--env`, the CLI targets production.
Use `--env stage` for staging and `--local` for a local dev server. `init` and
`spaces create` accept `--json` for script- and agent-friendly handoffs.

## Website Asset Inventory

Use `assets` to inspect the website state that generation commands create:

```bash
makefx assets
makefx assets --json
makefx assets show ASSET_ID --json
```

This is the CLI read side of the ForgeTray control loop. External agents can
list assets, select image variant IDs for `--refs`, inspect lineage, and
download a completed variant's media without direct database access:

```bash
makefx assets download VARIANT_ID -o references/variant.png
```

The command reads from the website API on demand. It does not scan the local
workspace and does not mirror website state into a local DB.

## Commands

Generate a new asset from text:

```bash
makefx generate "A watercolor background of Russafa market" \
  --name "Russafa Market Background" \
  --type scene \
  -o backgrounds/russafa-market.png
```

Before opening a website generation job, `generate`, `refine`, `derive`, and
`batch` print a preflight estimate with the billable usage units, workflow run
count, and estimated provider cost. The provider-cost value is attribution data
from the active provider price catalog, not a customer invoice total. If the
server preflight denies the request, the CLI stops before creating placeholder
variants.

Refine an existing variant:

```bash
makefx refine \
  --variant VARIANT_ID \
  "make it evening, warmer lights" \
  -o backgrounds/russafa-market-evening.png
```

Derive a new asset from references:

```bash
makefx derive \
  --refs CHARACTER_VARIANT_ID,BACKGROUND_VARIANT_ID \
  --name "Lucia in Market Scene" \
  --type scene \
  "Place Lucia naturally in the market, cinematic keyframe" \
  -o keyframes/lucia-market-001.png
```

Batch generate multiple images and write a debug run manifest:

```bash
makefx batch "Three cinematic keyframes in Russafa market" \
  --name "Russafa Market Keyframe" \
  --type scene \
  --count 3 \
  --output-dir keyframes/russafa-market
```

Generate audio through website jobs:

```bash
makefx audio voices

makefx audio speech generate "Podcast narration for the level intro" \
  --name "Intro Narration" \
  --voice voice_narrator \
  -o audio/intro-narration.wav

makefx audio dialogue generate --input scripts/blacksmith-dialogue.txt \
  --name "Blacksmith Dialogue" \
  --voice voice_default \
  --dialogue-voices voice_blacksmith,voice_player \
  -o audio/blacksmith-dialogue.wav

makefx audio music batch "Three 20 second low-intensity dungeon music beds" \
  --name "Dungeon Bed" \
  --count 3 \
  --output-dir audio/dungeon-beds

makefx audio sfx generate "A crisp inventory item pickup sound effect" \
  --name "Item Pickup" \
  -o audio/item-pickup.wav
```

Generate video through website jobs:

```bash
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

By default, video requests ask for native synchronized Veo audio. Current Veo
models do not support `--no-audio`; the CLI rejects it before creating a Space
job. Pass `--audio` explicitly when the soundtrack matters, and describe
dialogue, SFX, score, or ambience in the prompt.

## Durable Follow Mode

Single-output generation commands print the created variant ID as soon as the
Space accepts the request. If the CLI process exits, times out, or runs from
another terminal before the provider finishes, resume the wait and download by
following that durable Space variant:

```bash
makefx generate --follow VARIANT_ID -o backgrounds/russafa-market.png
makefx audio sfx generate --follow VARIANT_ID -o audio/item-pickup.wav
makefx video generate --follow VARIANT_ID -o video/idle.mp4
```

Follow mode does not create a second job system. It reads the current Space
state, returns immediately for completed or failed variants, and otherwise
waits for the same `variant:updated` lifecycle events used by the normal
generation command. On completion it downloads the media and writes the usual
debug run manifest from the variant recipe and asset record. Pass
`--timeout <seconds>` to override the default wait window.

When the website is configured with `INVENTORY_AUDIO_PROVIDER=elevenlabs`,
`audio music ...` prompts are generated through ElevenLabs music,
`audio sfx ...` prompts are generated through ElevenLabs sound effects, and
`audio speech ...`/`audio dialogue ...` prompts are generated through
ElevenLabs speech or dialogue. Music commands can opt into Lyria with
`--provider lyria`; ElevenLabs remains the default when the option is omitted.
Multi-speaker dialogue can be sent as direct
multiline shell text or with `--input <file>`; use one `Speaker: line` entry per
line.

Use `makefx audio voices` to list the connected ElevenLabs account's available
voices. Pass the printed `voiceId` with `--voice <voice_id>` for speech. For
dialogue, `--dialogue-voices <id,id,...>` maps voice IDs to speakers by first
appearance in the script, and `--voice` acts as the fallback voice for blank or
omitted dialogue slots. API keys, model IDs, and output format stay
server-controlled; CLI voice flags are per-call overrides.

Music provider selection is also a per-call override: pass `--provider lyria`
or `--provider elevenlabs` on `audio music` commands. The CLI sends the prompt,
canonical asset type, optional music provider, optional voice overrides, and
`mediaKind: "audio"`.

The older `audio generate ... --type <type>` and
`audio batch ... --type <type>` forms remain available as low-level
compatibility commands, but new automation should use the explicit mode
subcommands so the operation is discoverable from help and matches Forge Tray.

## Local References

`derive --refs`, `batch --refs`, and `video derive --refs` accept both existing
variant IDs and local image paths:

```bash
makefx derive \
  --refs ./lucia.png,VARIANT_BACKGROUND_ID \
  --name "Lucia in Market Scene" \
  --type scene \
  "Use image 1 as the character and image 2 as the background" \
  -o keyframes/lucia-market-001.png
```

Local image paths are mirrored into the website space. The CLI records the file
digest, Space, asset ID, and variant ID in `.inventory/mirrors.json`; matching
content is reused on later commands after the recorded variant is validated in
the current Space state. A same-path file with different content stops the
command instead of silently reusing the old reference or silently uploading a
duplicate. Video derive accepts completed image variants as provider references
and completed video variants as media lineage parents.

## Output Files

The CLI downloads the completed R2 artifact to the path passed with `-o` or
`--output`. Existing files are not overwritten unless `--force` is passed.
Generic audio artifacts are downloaded through the authenticated variant media
endpoint rather than by dereferencing raw R2 keys.

## Options

| Option | Commands | Description |
|--------|----------|-------------|
| `--space <id>` | all | Target website space; overrides project binding |
| `--name <name>` | `generate`, `derive`, `batch`, `audio <mode> generate`, `audio <mode> batch`, `video generate`, `video derive` | New asset name |
| `--type <type>` | `generate`, `derive`, `batch`, low-level `audio generate`, low-level `audio batch`, `video generate`, `video derive` | New asset type |
| `--variant <id>` | `refine`, `video refine` | Source variant to refine |
| `--refs <refs>` | `derive`, `batch`, `video derive` | Comma-separated variant IDs or local image paths |
| `--input <file>` | `audio <mode> generate` | Read prompt text from a file; useful for multiline speech and dialogue scripts |
| `--voice <id>` | `audio speech generate`, `audio dialogue generate`, low-level speech/dialogue audio commands | ElevenLabs speech voice, or dialogue fallback voice |
| `--dialogue-voices <ids>` | `audio dialogue generate`, `audio dialogue batch`, low-level dialogue audio commands | Comma-separated ElevenLabs voice IDs ordered by first speaker appearance |
| `-o`, `--output <file>` | `generate`, `refine`, `derive`, `audio <mode> generate`, `video generate`, `video refine`, `video derive` | Local download path |
| `--follow <variantId>` | single-output generation commands | Resume waiting for an existing Space variant and download it on completion |
| `--timeout <seconds>` | `--follow` mode | Override the follow wait timeout |
| `--output-dir <dir>` | `batch`, `audio <mode> batch` | Directory for downloaded batch files |
| `--count <2-8>` | `batch`, `audio <mode> batch` | Number of artifacts to generate |
| `--mode <mode>` | `batch`, `audio <mode> batch` | `explore` for one asset with many variants, or `set` for many assets |
| `--force` | all | Overwrite local output file |
| `--model <pro\|flash>` | top-level image commands | Optional image model selection; defaults to Pro |
| `--size <1K\|2K\|4K>` | top-level image commands | Optional image output size; Flash supports only `1K` |
| `--aspect <ratio>` | top-level image commands, video commands | Optional generation aspect ratio; video supports `16:9` or `9:16` |
| `--env <env>` | all | `production`, `stage`, or `local`; overrides project binding |
| `--local` | all | Shortcut for `--env local` |

Direct use of `gemini-images` or other generators remains intentionally
untracked by Inventory unless the resulting files are uploaded or used as local
references through these commands.

## Upload Provenance And Organization

Use `makefx upload` for a single file generated outside Make Effects that should
enter the Space with durable provenance:

```bash
makefx upload renders/hero-final.png \
  --name "Hero Final" \
  --type character \
  --prompt "full-body hero sheet, leather armor, neutral pose" \
  --model stable-diffusion-xl \
  --provider comfyui \
  --provider-metadata '{"seed":42,"sampler":"dpmpp-2m"}' \
  --generation-provenance '{"workflow":"character-sheet-v4"}' \
  --source-variant variant_face_sketch \
  --relation-type derived
```

Ready-made composites can record several source parents with a comma-separated
list:

```bash
makefx upload renders/cocina-scene.png \
  --name "Cocina" \
  --type scene \
  --source-variants variant_anna,variant_roman,variant_kitchen_bg
```

For multi-step uploads, chain commands through IDs returned by `--json`. Local
filenames are not durable identifiers after upload:

```bash
base_json=$(makefx upload refs/leather-armor.png \
  --name "Leather Armor Reference" \
  --type reference \
  --provider external \
  --generation-provenance '{"source":"licensed art pack"}' \
  --json)
base_variant=$(printf '%s' "$base_json" | jq -r '.variant.id')

hero_json=$(makefx upload renders/hero-final.png \
  --name "Hero Final" \
  --type character \
  --prompt "full-body hero sheet, leather armor, neutral pose" \
  --model stable-diffusion-xl \
  --provider comfyui \
  --provider-metadata '{"seed":42,"sampler":"dpmpp-2m"}' \
  --generation-provenance '{"workflow":"character-sheet-v4"}' \
  --source-variant "$base_variant" \
  --relation-type derived \
  --json)
hero_asset=$(printf '%s' "$hero_json" | jq -r '.variant.asset_id')
```

Lineage created during upload is immutable provenance. It is not the Space
organization model and should not be edited to arrange assets.

```bash
makefx upload refs/painterly.png \
  --name "Painterly Reference" \
  --type reference \
  --json
```

Audio generation currently supports only `generate` and `batch` for the
`speech`, `dialogue`, `music`, and `sfx` modes. It does not accept `--refs`,
`derive`, or `refine`. Audio batch downloads completed files into the requested
directory and writes debug local run manifests. ElevenLabs timestamp
responses are stored as transcript, timing, and render metadata sidecars on the
completed variant.
Video generation exposes `generate`, `refine`, and `derive`. Video batch is not
exposed because website batch jobs reject `mediaKind: "video"`.

## Run Manifests

Generation commands write debug JSON manifests to `.inventory/runs/<run-id>.json`
at the initialized project root, even when the command runs from a child
directory. The manifest maps downloaded local files to website asset IDs,
variant IDs, media keys, media kind, prompt, refs, command options, timestamps,
run success, and any failed variant errors. Image manifests also include an
`images` array for older local keyframe tooling; all media kinds use the generic
`media` array. Completed media files are still downloaded and recorded when
another batch member fails. These files are troubleshooting traces, not a local
asset database, and not a source of truth.

Inspect and export manifests only for debugging:

```bash
makefx runs --debug
makefx runs show --latest --debug
makefx runs show RUN_ID --debug --json
makefx runs export --latest --debug --format media -o media-run.json
makefx runs export --latest --debug --format remotion -o keyframes.json
```

The default `media` export writes ordered media data with local paths, absolute
paths resolved from the original command working directory, website IDs/URLs,
prompt, refs, and failed variant errors for local debugging. Image runs also
include the legacy ordered `images` keyframe array. The `remotion` format
remains available for debugging existing keyframe tooling and emits the same
media fields with the legacy `remotion-keyframes` format marker.

## Russafa Remotion Handoff

The Russafa workflow stays actor-driven. Make Effects CLI does not parse
`S01E01-A2.shotlist.md`, call `../subtitles` scripts, or render Remotion. The
external actor chooses prompts and refs from the shotlist, while the Make
Effects website remains the source of truth for assets, variants, and lineage.
Downloaded local files are handoff artifacts; local run manifests are debug
traces.

Example command shape for Diario de Russafa S01E01 A2:

```bash
makefx login
makefx spaces create "Diario de Russafa S01E01" --init

makefx upload ../subtitles/art/social-video/cast/anna-sheet-v1.jpg \
  --name "Anna cast sheet" \
  --type character

makefx upload ../subtitles/art/social-video/references/episode-backdrop-s01e01-kitchen-16x9-v1.jpg \
  --name "S01E01 kitchen backdrop" \
  --type scene

makefx derive \
  --refs <backdrop_variant>,<anna_variant>,<roman_variant> \
  --name "S01E01 A2 shot 01 keyframe" \
  --type scene \
  -o ../subtitles/art/social-video/references/episode-scene-s01e01-a2-01.jpg \
  "Compose the Cocina keyframe from the selected backdrop and cast references."

makefx video derive \
  --refs <shot01_keyframe_variant> \
  -o ../subtitles/art/social-video/russafa/clips/clip-s01e01-a2-01.mp4 \
  "medium shot; Anna moves toward the door; slow push-in"
```

`../subtitles` still owns `pnpm cli episodes download`, word timings,
`make:russafa`, and the Remotion render.

## End-To-End Test Loop

Run the media foundation loop without external generation providers:

```bash
pnpm run test:e2e:media-foundation
```

This builds the app, starts a local Wrangler worker with an isolated D1/R2/DO
state directory, uploads image/audio/video assets through the website API,
downloads them through authenticated variant media routes, checks range support,
triggers one WebSocket generation with the fake image provider, and verifies the
generated media through the same authenticated media route.

Run the CLI/worker media generation loop without external provider calls:

```bash
pnpm run test:e2e:cli-forge
```

This starts a local Wrangler worker, applies local D1 migrations in an isolated
temporary state directory, creates a dev-authenticated space, runs image
`generate`/`refine`/`derive`/`batch`, audio SFX generation, podcast dialogue
generation from `--input`, video `generate`/`derive`, and generic media export.
It verifies downloaded image, audio, and video files and forces fake backend
providers instead of calling Gemini, ElevenLabs, or Veo.
