# Inventory CLI

Command-line interface for the Inventory Forge platform. Provides space
management, website asset inspection, real-time event monitoring, media
uploading, Forge generation control, and billing management.

## Quick Start

Build the distributable CLI first:

```bash
pnpm run build:cli
dist/cli/inventory.mjs --version
```

```bash
# 1. Login first (if not already)
pnpm run cli login

# 2. Create or list spaces
pnpm run cli spaces                          # List all spaces
pnpm run cli spaces create "My Game Assets" --init  # Create new space and bind this directory

# 3. Bind this directory to a website space
pnpm run cli init --space YOUR_SPACE_ID

# 4. Listen to real-time events (in a separate terminal)
pnpm run cli listen --space YOUR_SPACE_ID

# 5. Upload image, audio, or video to create a new asset
pnpm run cli upload hero.png --space YOUR_SPACE_ID --name "Hero Character"
pnpm run cli upload theme.mp3 --space YOUR_SPACE_ID --name "Theme Music" --type audio
pnpm run cli upload cutscene.mp4 --space YOUR_SPACE_ID --name "Cutscene" --type video

# 6. Upload a variant to an existing asset
pnpm run cli upload variant.jpg --space YOUR_SPACE_ID --asset ASSET_ID

# 7. Generate through the website and download the completed image
pnpm run cli generate "A market background" --name "Market" --type scene -o market.png

# 8. Generate audio through website jobs and download the completed file
pnpm run cli audio generate "A short brass victory sting" --name "Victory Sting" --type audio -o audio/victory.wav

# 9. Inspect website assets and download an existing variant's media
pnpm run cli assets
pnpm run cli assets download VARIANT_ID -o references/variant.png
```

## Commands Overview

| Command | Description |
|---------|-------------|
| `login` | Authenticate with the API |
| `logout` | Remove stored credentials |
| `init` | Bind the current directory to a website space |
| `spaces` | List, view, or create spaces |
| `assets` | List website assets, show variants/lineage, download variants |
| `listen` | Connect to WebSocket and stream all events |
| `upload` | Upload image, audio, or video files to create assets or add variants |
| `generate` | Create a new asset through the website generation workflow |
| `refine` | Refine an existing variant through the website generation workflow |
| `derive` | Create a new asset from variant IDs and/or local image refs |
| `batch` | Generate multiple images and write a local run manifest |
| `audio` | Generate audio assets through website jobs |
| `runs` | List, inspect, and export local run manifests |
| `billing` | Billing sync status and management |

---

## Project Binding

Bind a filesystem workspace to a website space:

```bash
pnpm run cli init --space <space_id> [--env production|stage|local] [--json]
```

This writes `.inventory/config.json` with only the target environment and space
ID. It does not store assets, prompts, images, generation keys, or auth tokens.
Forge commands use this binding when `--space` or `--env` are omitted. Explicit
flags still override the project defaults.

The CLI defaults to production when no initialized project or `--env` flag is
present. Use `--env stage` for staging and `--local` for a local dev server.
Pass `--json` to `init` or `spaces create` when another agent or script needs
stable machine-readable output.

---

## Spaces

Manage your spaces (workspaces for organizing assets).

### List Spaces

```bash
pnpm run cli spaces                    # Simple list
pnpm run cli spaces --details          # With asset counts
pnpm run cli spaces --id <space_id>    # Details for specific space
```

### Create Space

```bash
pnpm run cli spaces create "My Space Name"
pnpm run cli spaces create --name "My Space Name"
```

---

## Asset Inventory

Inspect the website-backed asset graph for the initialized project space:

```bash
pnpm run cli assets
pnpm run cli assets --json
pnpm run cli assets show ASSET_ID
pnpm run cli assets show ASSET_ID --json
```

Asset inspection displays each asset's `media_kind`; `assets show` also displays
each variant's `media_kind`.

Download an existing completed variant or legacy image key to a local file:

```bash
pnpm run cli assets download VARIANT_ID -o references/variant.png
pnpm run cli assets download images/space/variant.png -o references/variant.png
pnpm run cli assets download VARIANT_ID -o audio/theme.mp3
```

Generic `media/...` artifacts must be downloaded by variant ID so the website
can authorize the space membership before resolving the R2 key.

`assets` calls the website API every time. It does not scan local files, create
a local asset database, or sync state into `.inventory`; the website remains the
source of truth. Use `--space`, `--env`, or `--local` to override the project
binding when needed.

---

## Listen Mode

Connect to a space's WebSocket and stream all events in real-time. Useful for debugging, monitoring, and understanding the event flow.

```bash
pnpm run cli listen --space <space_id>           # Pretty-printed output
pnpm run cli listen --space <space_id> --json    # Raw JSON (for piping)
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

Upload image, audio, or video files to create new assets or add variants to
existing assets.

### Create New Asset

```bash
pnpm run cli upload <file> --name <name> [--space <id>] [options]
```

### Add Variant to Existing Asset

```bash
pnpm run cli upload <file> --asset <id> [--space <id>]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `<file>` | Yes | Path to image, audio, or video file |
| `--space <id>` | No | Target space ID; defaults from initialized project |
| `--asset <id>` | * | Target asset ID (upload as new variant) |
| `--name <name>` | * | New asset name (creates asset + variant) |
| `--type <type>` | No | Asset type for new assets (default: `character`) |
| `--media-kind <kind>` | No | Optional explicit kind: `image`, `audio`, or `video` |
| `--parent <id>` | No | Parent asset ID for new assets |
| `--env <env>` | No | `production`, `stage`, or `local` (default: `production`) |
| `--local` | No | Shortcut for `--env local` |

\* Either `--asset` or `--name` is required.

**Supported formats:** `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.mp3`,
`.m4a`, `.aac`, `.wav`, `.ogg`, `.flac`, `.mp4`, `.m4v`, `.mov`, `.webm`
(max 10MB). `.webm` uploads default to video.

**Examples:**
```bash
# Create a new character asset from an image
pnpm run cli upload hero.png --space abc123 --name "Hero Character"

# Create with specific type and parent
pnpm run cli upload sword.png --space abc123 --name "Sword" --type item --parent abc789

# Add a variant to an existing asset
pnpm run cli upload variant.jpg --space abc123 --asset def456

# Upload audio and video assets
pnpm run cli upload theme.mp3 --space abc123 --name "Theme Music" --type audio
pnpm run cli upload cutscene.mp4 --space abc123 --name "Opening Cutscene" --type video

# Upload against local dev server
pnpm run cli upload hero.png --space abc123 --name "Hero" --local
```

---

## Forge Generation

The CLI can act as a ForgeTray controller for an existing website space. The
website remains authoritative for assets, variants, recipes, lineage, and R2
storage; the CLI sends generation requests and downloads completed media.
The top-level `generate`, `refine`, `derive`, and `batch` commands are
image-only and send `mediaKind: "image"`.

```bash
pnpm run cli generate "A watercolor background of Russafa market" \
  --name "Russafa Market Background" \
  --type scene \
  -o backgrounds/russafa-market.png

pnpm run cli refine \
  --variant VARIANT_ID \
  "make it evening, warmer lights" \
  -o backgrounds/russafa-market-evening.png

pnpm run cli derive \
  --refs ./lucia.png,VARIANT_BACKGROUND_ID \
  --name "Lucia in Market Scene" \
  --type scene \
  "Use image 1 as the character and image 2 as the background" \
  -o keyframes/lucia-market-001.png

pnpm run cli batch "Three cinematic keyframes in Russafa market" \
  --name "Russafa Market Keyframe" \
  --type scene \
  --count 3 \
  --output-dir keyframes/russafa-market
```

`derive --refs` accepts existing variant IDs and local image paths. Local
images are uploaded first as `reference` assets, then their uploaded variant IDs
are used in the derive request.

`batch` downloads every completed image and writes
`.inventory/runs/<run-id>.json` at the initialized project root, with local
paths, website asset/variant IDs, image keys, prompt, refs, command options,
timestamps, run success, and failed variant errors for downstream Remotion or
video tooling.

## Audio Generation

Audio controller commands use the same website Space Durable Object and
GenerationWorkflow job lifecycle as image generation. They send
`mediaKind: "audio"` and download the completed variant through the
authenticated variant media endpoint.

```bash
pnpm run cli audio generate "A short brass victory sting" \
  --name "Victory Sting" \
  --type audio \
  -o audio/victory.wav

pnpm run cli audio batch "Three short UI notification sounds" \
  --name "Notification Sound" \
  --type audio \
  --count 3 \
  --output-dir audio/notifications
```

Audio generation currently does not accept `--refs`, `derive`, or `refine`
commands. Audio batch downloads completed files into the requested directory but
does not write image keyframe run manifests.

## Run Manifests

```bash
pnpm run cli runs
pnpm run cli runs show --latest
pnpm run cli runs show RUN_ID --json
pnpm run cli runs export --latest --format remotion -o keyframes.json
```

`runs` reads local `.inventory/runs` manifests from the initialized project root
and does not call generation APIs. The Remotion export is a compact JSON handoff
with ordered image paths, absolute paths resolved from the original batch
command working directory, website IDs/URLs, prompt, refs, and failed variant
errors.

See [cli-generation.md](./cli-generation.md) for the full command reference.

---

## Billing

View billing sync status and manage usage.

```bash
pnpm run cli billing status
pnpm run cli billing check
```

---

## Troubleshooting

### "Not logged in" Error

```bash
pnpm run cli login
```

### "Token expired" Error

```bash
pnpm run cli login
```
