# Make Effects CLI

Command-line interface for the Make Effects platform. Provides space
management, website asset inspection, real-time event monitoring, media
uploading, Forge generation control, and billing management.

## Quick Start

Build the distributable CLI first:

```bash
pnpm run build:cli
dist/cli/makefx.mjs --version
```

```bash
# 1. Login first (if not already)
makefx login

# 2. Create or list spaces
makefx spaces                          # List all spaces
makefx spaces create "My Game Assets" --init  # Create new space and bind this directory

# 3. Bind this directory to a website space
makefx init --space YOUR_SPACE_ID

# 4. Listen to real-time events (in a separate terminal)
makefx listen --space YOUR_SPACE_ID

# 5. Upload image, audio, or video to create a new asset
makefx upload hero.png --space YOUR_SPACE_ID --name "Hero Character"
makefx upload theme.mp3 --space YOUR_SPACE_ID --name "Theme Music" --type audio
makefx upload cutscene.mp4 --space YOUR_SPACE_ID --name "Cutscene" --type video

# 6. Upload a variant to an existing asset
makefx upload variant.jpg --space YOUR_SPACE_ID --asset ASSET_ID

# 7. Generate through the website and download the completed image
makefx generate "A market background" --name "Market" --type scene -o market.png

# 8. Generate audio through website jobs and download the completed file
makefx audio sfx generate "A short brass victory sting" --name "Victory Sting" -o audio/victory.wav

# 9. Generate video through website jobs and download the completed file
makefx video generate "A looping idle animation" --name "Idle Animation" --type animation -o video/idle.mp4

# 10. Inspect website assets and download an existing variant's media
makefx assets
makefx assets download VARIANT_ID -o references/variant.png
```

## Commands Overview

| Command | Description |
|---------|-------------|
| `login` | Authenticate with the API |
| `logout` | Remove stored credentials |
| `init` | Bind the current directory to a website space |
| `spaces` | List, view, or create spaces |
| `assets` | List/show/download assets; delete, rename, set-active |
| `variants` | Delete, retry, star/unstar, and rate variants |
| `styles` | List style references, manage style reference collections, and manage style presets |
| `usage` | Show platform storage and workflow consumption for a space |
| `spend` | Show admin provider cost summaries |
| `rotation` | Experimental rotation views from a completed image variant; hidden unless rotation flags are enabled |
| `tileset` | Generate and monitor consistent tile sets |
| `listen` | Connect to WebSocket and stream all events |
| `upload` | Upload media files or JSON manifests to create assets, variants, and import metadata |
| `generate` | Create a new asset through the website generation workflow |
| `refine` | Refine an existing variant through the website generation workflow |
| `derive` | Create a new asset from variant IDs and/or local image refs |
| `batch` | Generate multiple images and write a debug local run manifest |
| `audio` | Generate audio assets through website jobs |
| `video` | Generate and refine video assets through website jobs |
| `runs` | Debug-only local run manifest inspection and export |
| `productions` | List, place, delete, and export Space-backed production records |
| `billing` | Billing sync status and management |

---

## Project Binding

Bind a filesystem workspace to a website space:

```bash
makefx init --space <space_id> [--env production|stage|local] [--json]
```

This writes `.inventory/config.json` with only the target environment and space
ID. It does not store assets, prompts, images, generation keys, or auth tokens.
Forge commands use this binding when `--space` or `--env` are omitted. Explicit
flags still override the project defaults.

The CLI defaults to production when no initialized project or `--env` flag is
present. Use `--env stage` for staging and `--local` for a local dev server.
Pass `--json` to `init`, `spaces`, `spaces --details`, `spaces --id`, or
`spaces create` when another agent or script needs stable machine-readable
output.

---

## Spaces

Manage your spaces (workspaces for organizing assets).

### List Spaces

```bash
makefx spaces                    # Simple list
makefx spaces --details          # With asset counts
makefx spaces --id <space_id>    # Details for specific space
```

### Create Space

```bash
makefx spaces create "My Space Name"
makefx spaces create --name "My Space Name"
```

---

## Asset Inventory

Inspect the website-backed asset graph for the initialized project space:

```bash
makefx assets
makefx assets --json
makefx assets show ASSET_ID
makefx assets show ASSET_ID --json
```

Asset inspection displays each asset's `media_kind`; `assets show` also displays
each variant's `media_kind`, generation provenance, and provider metadata from
Space state.

Download an existing completed variant or legacy image key to a local file:

```bash
makefx assets download VARIANT_ID -o references/variant.png
makefx assets download images/space/variant.png -o references/variant.png
makefx assets download VARIANT_ID -o audio/theme.mp3
```

Generic `media/...` artifacts must be downloaded by variant ID so the website
can authorize the space membership before resolving the R2 key.

`assets` read commands call the website API every time. They do not scan local
files, create a local asset database, or sync state into `.inventory`; the
website remains the source of truth. Use `--space`, `--env`, or `--local` to
override the project binding when needed.

## Platform Usage

Inspect platform-side storage and workflow consumption for the initialized
project space:

```bash
makefx usage
makefx usage --from 2026-06-01 --to 2026-06-30
makefx usage --json
```

The command calls `GET /api/spaces/:id/usage/summary` with the same authenticated
space membership checks as asset reads. Human-readable output highlights current
storage bytes, workflow runs, and delivered media bytes; `--json` returns the
full summary including usage-type and media-kind breakdowns.

## Provider Cost

Admins can inspect raw provider cost recorded in the provider usage ledger:

```bash
makefx spend
makefx spend --from 2026-06-01 --to 2026-06-30
makefx spend --user-id 42 --provider gemini --media-kind image
makefx spend --json
```

The command calls `GET /api/billing/spend/summary` and requires an authenticated
admin session. Human-readable output includes total provider cost, entry counts,
unpriced entry counts, and breakdowns by provider, model, media kind, and meter.

## Style Libraries

Manage Space style references for the initialized project space:

```bash
makefx styles references
makefx styles collections list
makefx styles collections create "Painterly refs" --refs asset_123,variant_456
makefx styles collections update collection_123 --refs asset_789,variant_999
makefx styles presets list
makefx styles presets create "Painterly" --collection collection_123 --prompt "Painterly adventure game" --default
makefx styles presets update preset_123 --prompt "Painterly adventure game, crisp ink"
makefx styles presets disable preset_123
makefx styles presets enable preset_123
makefx styles presets delete preset_123
```

Style reference collections are normal Space collections whose items use the
`style_ref` role. Passing asset IDs pins each asset's active variant; passing
variant IDs references those variants directly. Style references stay visible as
ordinary Space assets and variants; presets only select collections plus a style
prompt.

Generation can select an enabled style preset by ID or exact name:

```bash
makefx generate "A market background" --style-preset Painterly --name "Market" --type scene -o market.png
makefx derive --refs character_variant --style-preset preset_123 --name "Market Keyframe" --type scene "Place the hero in the market" -o keyframe.png
makefx generate "A neutral prop sheet" --no-style --name "Props" --type prop -o props.png
```

When a preset is selected, generation output prints the resolved preset ID,
collection, and reference count before the job starts. `--style-preset` is
mutually exclusive with `--no-style`.

### Managing Assets and Variants

Mutating commands talk to the space over the same authenticated WebSocket the web
app uses, and broadcast their result to every connected client. Each command
opens a short-lived connection, performs one operation, waits for the space to
confirm it, and exits.

```bash
# Asset-level operations
makefx assets delete ASSET_ID                 # delete an asset and its variants
makefx assets rename ASSET_ID "New Name"      # rename an asset
makefx assets set-active ASSET_ID VARIANT_ID  # choose the active variant

# Variant-level operations
makefx variants delete VARIANT_ID             # delete a single variant
makefx variants retry VARIANT_ID              # retry a failed variant generation
makefx variants star VARIANT_ID               # star (curation)
makefx variants unstar VARIANT_ID             # unstar
makefx variants rate VARIANT_ID approved      # rate approved | rejected
```

Notes:

- `assets delete` and `variants delete` require space-owner permission; the other
  mutations require editor permission. Permission and not-found errors are
  reported with the server's reason.
- `variants retry` only works on `failed` variants and re-queues the original
  recipe. It returns once the variant is re-queued (status `pending`); watch
  progress with `assets show ASSET_ID` or `listen`.
- Deleting the active variant reassigns the asset's active variant automatically
  (to another completed variant when one exists).

---

## Rotation Views And Tile Sets

Rotation and tile-set pipelines use the same authenticated Space WebSocket as
the web app. By default the CLI starts the pipeline, streams progress, and waits
for a terminal `completed`, `failed`, or `cancelled` event. Pass `--detach` to
return after the Space confirms the pipeline has started.

Rotation generation is currently experimental and hidden by default. Set
`MAKEFX_ROTATION_ENABLED=true` before exposing it end to end.

When the flags are enabled, generate rotation views from a completed image variant:

```bash
makefx rotation --variant VARIANT_ID --config 8-directional
makefx rotation --variant VARIANT_ID --config turnaround --mode single-shot --subject "hero knight"
makefx rotation --variant VARIANT_ID --config 4-directional --detach
makefx rotation cancel ROTATION_SET_ID
```

Rotation options:

| Option | Description |
|--------|-------------|
| `--variant <id>` | Completed source image variant to rotate |
| `--config <config>` | `4-directional`, `8-directional`, or `turnaround` (default: `4-directional`) |
| `--subject <text>` | Optional subject description for consistency prompts |
| `--aspect <ratio>` | Optional generation aspect ratio |
| `--mode <mode>` | `sequential` or `single-shot` (default: `sequential`) |
| `--no-style` | Disable style preset injection for this request |
| `--detach` | Return after `rotation:started` |
| `--timeout <sec>` | Override the wait timeout |
| `--json` | Print machine-readable output |

Generate a tile set:

```bash
makefx tileset "grass and stone path tiles" --type terrain --grid 3x3
makefx tileset "shop wall and roof tiles" --type building --width 4 --height 2
makefx tileset "crystal floor tiles" --type custom --grid 3 --seed-variant VARIANT_ID
makefx tileset cancel TILE_SET_ID
```

Tile-set options:

| Option | Description |
|--------|-------------|
| `--type <type>` | `terrain`, `building`, `decoration`, or `custom` (default: `terrain`) |
| `--grid <size>` | Square size or `WIDTHxHEIGHT`, each dimension 2-5 (default: `3`) |
| `--width <n>` / `--height <n>` | Grid dimensions when not using `--grid` |
| `--seed-variant <id>` | Optional completed image variant to place at the center; sequential mode only |
| `--aspect <ratio>` | Optional generation aspect ratio |
| `--mode <mode>` | `sequential` or `single-shot` (default: `sequential`) |
| `--no-style` | Disable style preset injection for this request |
| `--detach` | Return after `tileset:started` |
| `--timeout <sec>` | Override the wait timeout |
| `--json` | Print machine-readable output |

---

## Listen Mode

Connect to a space's WebSocket and stream all events in real-time. Useful for debugging, monitoring, and understanding the event flow.

```bash
makefx listen --space <space_id>           # Pretty-printed output
makefx listen --space <space_id> --json    # Raw JSON (for piping)
```

**Example output:**
```
Connected! Listening for events...
Press Ctrl+C to exit

[14:32:01.123] sync:state
  Assets: 5, Variants: 12, Lineage: 3

[14:32:15.456] generate:started
  Request: abc123-def456
  Job: xyz789 for Silver Warrior [asset_123]

[14:32:25.789] variant:updated
  Variant: xyz789 [completed]

[14:32:25.801] job:completed
  Job: xyz789 → completed (variant: xyz789)
```

**Event types displayed:**
- `sync:state` - Initial state sync
- `asset:created/updated/deleted` - Asset changes
- `variant:created/updated/deleted` - Variant changes
- `generate:started/result` - Generation workflow events
- `refine:started/result` - Refinement workflow events
- `chat:response` - Chat responses
- `job:progress/completed/failed` - Job status changes
- `presence:update` - User presence changes
- `lineage:created/severed` - Variant lineage changes

---

## Upload

Import one image, audio, or video file to create a new asset or add a variant to
an existing asset. Upload can also attach imported provenance, immutable lineage
from existing variants, collection placement, and manual relations in the same
file-oriented command. Use `makefx upload <manifest.json>` for JSON manifest
batches, same-batch lineage, compositions, style presets, or name-based
organization metadata.

### Create New Asset

```bash
makefx upload <file> --name <name> [--space <id>] [options]
```

### Add Variant to Existing Asset

```bash
makefx upload <file> --asset <id> [--space <id>]
```

### Upload Manifest

```bash
makefx upload <manifest.json> [--space <id>] [--dry-run] [--json]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `<file>` | Yes | Path to image, audio, or video file |
| `--space <id>` | No | Target space ID; defaults from initialized project |
| `--asset <id>` | * | Target asset ID (import as new variant) |
| `--name <name>` | * | New asset name (creates asset + variant) |
| `--type <type>` | No | Asset type for new assets (default: `character`) |
| `--media-kind <kind>` | No | Optional explicit kind: `image`, `audio`, or `video` |
| `--prompt <text>` | No | Imported prompt provenance |
| `--model <model>` | No | Imported model provenance |
| `--provider <name>` | No | Imported provider provenance |
| `--provider-metadata <json>` | No | Provider metadata JSON object |
| `--generation-provenance <json>` | No | Extra provenance JSON object |
| `--source-variant <id>` | No | Existing Space variant to record as import lineage source |
| `--relation-type <type>` | No | Lineage type: `derived`, `refined`, or `forked` (default: `derived`) |
| `--active-variant-behavior <behavior>` | No | `if-missing`, `set-active`, or `keep` |
| `--collection <ids>` | No | Comma-separated collection IDs for the uploaded asset or variant |
| `--collection-role <role>` | No | Collection item role (default: `member`) |
| `--collection-subject <type>` | No | `asset` or `variant` (default: `asset`) |
| `--collection-pinned-variant <id\|uploaded\|none>` | No | Pin asset collection placement to the uploaded variant by default |
| `--manual-relation <spec>` | No | Comma-separated `<type>:asset:<id>` or `<type>:variant:<id>` relation targets |
| `--manual-relation-subject <type>` | No | Uploaded relation subject: `asset` or `variant` (default: `variant`) |
| `--manual-relation-label <text>` | No | Manual relation label |
| `--manual-relation-context <json\|text>` | No | Manual relation context |
| `--manual-relation-metadata <json>` | No | Manual relation metadata object |
| `--dry-run` | No | Validate a JSON manifest without uploading media bytes |
| `--json` | No | Print machine-readable manifest import or dry-run output |
| `--env <env>` | No | `production`, `stage`, or `local` (default: `production`) |
| `--local` | No | Shortcut for `--env local` |

\* Either `--asset` or `--name` is required.

**Supported formats:** `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.mp3`,
`.m4a`, `.aac`, `.wav`, `.ogg`, `.flac`, `.mp4`, `.m4v`, `.mov`, `.webm`
(max 10MB). `.webm` uploads default to video.

**Examples:**
```bash
# Create a new character asset from an image
makefx upload hero.png --space abc123 --name "Hero Character"

# Create with specific type
makefx upload sword.png --space abc123 --name "Sword" --type item

# Add a variant to an existing asset
makefx upload variant.jpg --space abc123 --asset def456

# Upload audio and video assets
makefx upload theme.mp3 --space abc123 --name "Theme Music" --type audio
makefx upload cutscene.mp4 --space abc123 --name "Opening Cutscene" --type video

# Import one externally produced file with provenance and lineage
makefx upload paintover.png --space abc123 --asset def456 \
  --prompt "cleaner silhouette" \
  --provider local-tool \
  --provider-metadata '{"seed":42}' \
  --generation-provenance '{"workflow":"paintover-v1"}' \
  --source-variant var789 \
  --relation-type refined \
  --active-variant-behavior set-active

# Upload against local dev server
makefx upload hero.png --space abc123 --name "Hero" --local

# Place the uploaded asset in a collection and pin the uploaded variant
makefx upload hero.png --space abc123 --name "Hero" \
  --collection collection_cast \
  --collection-role character

# Place the exact uploaded variant in a collection
makefx upload hero-pose.png --space abc123 --asset asset_hero \
  --collection collection_poses \
  --collection-subject variant

# Create a manual relation from the uploaded variant to an existing asset
makefx upload thumbnail.png --space abc123 --asset asset_thumb \
  --manual-relation thumbnail_for:asset:asset_target

# Add relation metadata
makefx upload prop.png --space abc123 --name "Market Prop" \
  --manual-relation appears_in:variant:variant_scene \
  --manual-relation-context '{"scene":"market"}'

# Validate a manifest before upload
makefx upload import-manifest.json --space abc123 --dry-run --json
```

Manual relation types include `appears_in`, `background_for`,
`thumbnail_for`, `map_for`, `style_reference_for`, and `reference_for`.
Collection and manual relation targets are existing Space IDs and are checked
before the media upload starts. Use `--source-variant` only for immutable import
lineage; use `--manual-relation` for editable organization links.

---

## Manifest Upload

Import a JSON manifest of externally generated files with prompt, model,
provider metadata, generation provenance, related source images, and immutable
variant lineage.

```bash
makefx upload import-manifest.json --space abc123 --dry-run
makefx upload import-manifest.json --space abc123 --json
```

The manifest may be a top-level array or `{ "records": [...] }`. File paths are
resolved relative to the manifest file. Each record sets `file`, either `assetId`
for an existing asset or `name` for a new asset, optional `assetType`/`type`,
`mediaKind`, `activeVariantBehavior` (`if-missing`, `set-active`, or `keep`),
`prompt`, `model`, `provider`, `providerMetadata`, and arbitrary
`generationProvenance` fields. Those fields become provenance on the imported
variant; they are not editable organization metadata.

Lineage is import-only provenance. Each `lineage` entry must use relation type
`derived`, `refined`, or `forked`, and set exactly one source: `sourceFile` for
another record in the same manifest, or `sourceVariantId` for an existing Space
variant. Use manual `relations`, `collections`, and `compositions` for
organization instead of editing lineage.

```json
{
  "records": [
    {
      "key": "base",
      "file": "renders/base.png",
      "name": "Base Render",
      "assetType": "character",
      "prompt": "full-body hero sheet, leather armor, neutral pose",
      "model": "stable-diffusion-xl",
      "provider": "comfyui",
      "providerMetadata": { "seed": 42, "sampler": "dpmpp-2m" },
      "generationProvenance": {
        "tool": "comfyui",
        "workflow": "character-sheet-v4",
        "sourceImages": ["refs/leather-armor.png", "refs/face-sketch.png"]
      }
    },
    {
      "key": "refined",
      "file": "renders/refined.png",
      "assetId": "asset_existing",
      "activeVariantBehavior": "set-active",
      "prompt": "same hero, cleaner silhouette, stronger inventory icon read",
      "model": "gemini-3-pro-image-preview",
      "provider": "gemini",
      "providerMetadata": { "requestId": "external-job-7781" },
      "generationProvenance": { "importedFrom": "external paintover batch" },
      "lineage": [
        { "sourceFile": "base", "relationType": "refined" },
        { "sourceVariantId": "variant_existing", "relationType": "derived" }
      ]
    }
  ]
}
```

`--dry-run` validates files, authentication, Space membership, target assets,
external source variant IDs, same-batch source keys, duplicate local keys, media
kinds, and lineage relation types without uploading media bytes.

Manifests can also import organization metadata after upload. Collection and
composition references use existing names unless a top-level entry explicitly
sets `create: true`. Same-batch references use the imported record `key`.
Collections organize assets or pinned variants, manual relations describe
user-authored links, and compositions bind exact variants into final mixes.
None of those organization sections rewrites lineage.

```json
{
  "collections": [
    { "name": "Backgrounds", "create": true }
  ],
  "styleCollections": [
    { "name": "Painterly refs", "create": true }
  ],
  "compositions": [
    { "name": "Opening Shot", "create": true, "output": { "recordKey": "final" } }
  ],
  "records": [
    {
      "key": "style-ref",
      "file": "refs/painterly.png",
      "name": "Painterly Reference",
      "styleCollections": ["Painterly refs"]
    },
    {
      "key": "final",
      "file": "renders/final.png",
      "name": "Final Keyframe",
      "prompt": "hero entering the market, painterly adventure game style",
      "model": "external-compositor-1",
      "provider": "local-render-farm",
      "providerMetadata": { "jobId": "render-90210" },
      "generationProvenance": {
        "sourceImages": ["style-ref", "asset_thumbnail_target"],
        "operator": "outsourced-art-pass"
      },
      "collections": [
        { "collection": "Backgrounds", "role": "background", "subjectType": "asset" }
      ],
      "compositionItems": [
        { "composition": "Opening Shot", "role": "output", "label": "Final frame" }
      ],
      "relations": [
        {
          "object": { "assetId": "asset_thumbnail_target", "subjectType": "asset" },
          "relationType": "thumbnail_for"
        }
      ]
    }
  ],
  "stylePresets": [
    {
      "name": "Painterly",
      "create": true,
      "collection": "Painterly refs",
      "stylePrompt": "Painterly adventure game",
      "default": true
    }
  ]
}
```

Top-level `collectionItems`, `relations`, and `compositionItems` are also
accepted. Composition item roles are `output`, `background`, `character`,
`prop`, `style_ref`, `overlay`, `map`, `thumbnail`, or `custom`. Manual relation
types include `appears_in`, `background_for`, `thumbnail_for`, `map_for`,
`style_reference_for`, and `reference_for`. JSON output reports created asset
IDs, variant IDs, lineage IDs, collection item IDs, relation IDs, composition
item IDs, and style preset IDs after import.

Style reference imports use the same model as the rest of the Space: import the
reference images as normal assets, add them to style collections, then create or
update style presets that point to those collections. There is no separate
style-only upload path.

---

## Forge Generation

The CLI can act as a ForgeTray controller for an existing website space. The
website remains authoritative for assets, variants, recipes, lineage, and R2
storage; the CLI sends generation requests and downloads completed media.
The top-level `generate`, `refine`, `derive`, and `batch` commands are
image-only and send `mediaKind: "image"`. Video commands live under the
explicit `video` namespace.

```bash
makefx generate "A watercolor background of Russafa market" \
  --name "Russafa Market Background" \
  --type scene \
  -o backgrounds/russafa-market.png

makefx refine \
  --variant VARIANT_ID \
  "make it evening, warmer lights" \
  -o backgrounds/russafa-market-evening.png

makefx derive \
  --refs ./lucia.png,VARIANT_BACKGROUND_ID \
  --name "Lucia in Market Scene" \
  --type scene \
  "Use image 1 as the character and image 2 as the background" \
  -o keyframes/lucia-market-001.png

makefx batch "Three cinematic keyframes in Russafa market" \
  --name "Russafa Market Keyframe" \
  --type scene \
  --count 3 \
  --output-dir keyframes/russafa-market
```

`derive --refs` accepts existing variant IDs and local image paths. Local
images are uploaded first as `reference` assets, then their uploaded variant IDs
are used in the derive request.

Generation commands download completed media and write debug-only
`.inventory/runs/<run-id>.json` at the initialized project root, with local
paths, website asset/variant IDs, media keys, media kind, prompt, refs, command
options, timestamps, run success, and failed variant errors. These manifests are
not a source of truth and must not drive production assembly. Image manifests
also retain the legacy `images` keyframe array for troubleshooting older local
handoff tooling.

Single-output generation commands also print the created variant ID as soon as
the Space accepts the request. If the CLI process exits or times out before the
provider finishes, follow that existing Space variant instead of starting a new
job:

```bash
makefx generate --follow VARIANT_ID -o backgrounds/russafa-market.png
makefx audio sfx generate --follow VARIANT_ID -o audio/item-pickup.wav
makefx video generate --follow VARIANT_ID -o video/idle.mp4
```

Follow mode reads the current Space state, returns immediately for completed or
failed variants, or waits for the same `variant:updated` lifecycle events used
by normal generation. On completion it downloads the media and writes the usual
debug run manifest from the durable variant recipe. Pass `--timeout <seconds>`
to override the default wait window.

## Audio Generation

Audio controller commands use the same website Space Durable Object and
GenerationWorkflow job lifecycle as image generation. They send
`mediaKind: "audio"` and download the completed variant through the
authenticated variant media endpoint.

Canonical audio commands make the Forge Tray mode explicit: `speech`,
`dialogue`, `music`, or `sfx`. The CLI sends the matching canonical asset type
and `mediaKind: "audio"`.

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

makefx audio music generate "A 30 second bright orchestral menu loop" \
  --provider lyria \
  --name "Menu Loop" \
  -o audio/menu-loop.wav

makefx audio sfx generate "A crisp inventory item pickup sound effect" \
  --name "Item Pickup" \
  -o audio/item-pickup.wav
```

Dialogue and speech prompts can also be passed as direct multiline shell text.
`--input <file>` is the practical path for reusable dialogue scripts, with one
`Speaker: line` entry per line for multi-speaker dialogue.

Use `makefx audio voices` to list the connected ElevenLabs account's voice
library. It prints `voiceId` values for `--voice` and `--dialogue-voices`;
`--json` returns the raw `{ available, voices }` response. `--voice` selects the
speech voice and also acts as a fallback for dialogue speakers whose ordered
slot is blank or omitted. `--dialogue-voices <id,id,...>` maps voice IDs to
dialogue speakers by first appearance in the script.

Music uses the server default provider unless `--provider lyria` or
`--provider elevenlabs` is supplied. The provider option is valid only for
`audio music` commands.

Audio generation currently does not accept `--refs`, `derive`, or `refine`
commands. Audio batch downloads completed files into the requested directory and
writes debug local run manifests.

## Video Generation

Video controller commands use the same website Space Durable Object and
GenerationWorkflow job lifecycle as image and audio generation. They send
`mediaKind: "video"` and download the completed variant through the
authenticated variant media endpoint.

```bash
makefx video generate "A looping idle animation" \
  --name "Idle Animation" \
  --type animation \
  --duration 6 \
  --resolution 1080p \
  --tier fast \
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

`video derive --refs` accepts completed image variant IDs, completed video
variant IDs, and local image paths. Local paths are uploaded first as reference
image assets. Video batch generation is not exposed because website batch jobs
reject `mediaKind: "video"`.

By default, video requests ask for native synchronized Veo audio. Current Veo
models do not support `--no-audio`; the CLI rejects it before creating a Space
job. Pass `--audio` explicitly when the soundtrack matters, and describe
dialogue, SFX, score, or ambience in the prompt.
Pass `--aspect 16:9|9:16`, `--resolution 720p|1080p|4k`,
`--duration 4|6|8`, and `--tier generate|fast|lite` to select the Veo output
controls for that request; those choices are stored in the variant recipe and
preserved on retry. The `lite` tier supports `720p` and `1080p`; use
`generate` or `fast` for `4k`.

## Run Manifests

```bash
makefx runs --debug
makefx runs show --latest --debug
makefx runs show RUN_ID --debug --json
makefx runs export --latest --debug --format media -o media-run.json
makefx runs export --latest --debug --format remotion -o keyframes.json
```

`runs` reads local `.inventory/runs` manifests from the initialized project root
and does not call generation APIs. It requires `--debug` because local manifests
are troubleshooting traces, not production state. The default `media` export is
a compact JSON debug view with ordered media paths, absolute paths resolved from
the original command working directory, website IDs/URLs, prompt, refs, and
failed variant errors. Image runs also include an ordered `images` keyframe
array for existing local tools. Use `--format remotion` only when debugging an
older keyframe pipeline that expects the legacy `remotion-keyframes` format
marker.

## Production Records

Production scene placement is stored in the Space, not inferred from local run
manifests. When `generate`, `refine`, `derive`, or the matching `video`
commands include `--production-id`, `--scene-label`, and
`--timeline-start-ms`, the completed variant is placed into the Space-backed
production timeline. Use `productions place` to place an existing variant.

```bash
makefx productions list --production-id s01e01-a2
makefx productions place \
  --production-id s01e01-a2 \
  --variant VARIANT_ID \
  --scene-label "Cocina" \
  --timeline-start-ms 0
makefx productions export --production-id s01e01-a2 -o scenes.args
makefx productions export --production-id s01e01-a2 --json -o scenes.json
makefx productions export --production-id s01e01-a2 --media-dir handoff/media -o scenes.args
makefx productions delete RECORD_ID
```

`productions export` reads the Space records, downloads image and video media
through the authenticated CLI session, and emits sorted shell-ready
`--scene '<startMs>|<label>|<absolute-media-path>'` lines. By default the media
is written beside `-o` in a `<name>.media/` directory; pass `--media-dir` to
choose a different download directory.

See [cli-generation.md](./cli-generation.md) for the full command reference.

---

## Billing

View billing sync status, run Polar operational checks, and reconcile one
customer billing period against Polar meter usage plus local charge, provider
cost, and platform usage ledgers.

```bash
makefx billing status
makefx billing check
makefx billing reconcile --user-id 42
makefx billing retry-failed
```

---

## Troubleshooting

### "Not logged in" Error

```bash
makefx login
```

### "Token expired" Error

```bash
makefx login
```
