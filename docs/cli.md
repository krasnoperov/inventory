# Inventory CLI

Command-line interface for the Inventory Forge platform. Provides space
management, website asset inspection, real-time event monitoring, image
uploading, Forge generation control, and billing management.

## Quick Start

```bash
# 1. Login first (if not already)
pnpm run cli login --env stage

# 2. Create or list spaces
pnpm run cli spaces                          # List all spaces
pnpm run cli spaces create "My Game Assets"  # Create new space

# 3. Bind this directory to a website space
pnpm run cli init --space YOUR_SPACE_ID --env stage

# 4. Listen to real-time events (in a separate terminal)
pnpm run cli listen --space YOUR_SPACE_ID

# 5. Upload an image to create a new asset
pnpm run cli upload hero.png --space YOUR_SPACE_ID --name "Hero Character"

# 6. Upload a variant to an existing asset
pnpm run cli upload variant.jpg --space YOUR_SPACE_ID --asset ASSET_ID

# 7. Generate through the website and download the completed image
pnpm run cli generate "A market background" --name "Market" --type scene -o market.png

# 8. Inspect website assets and download an existing variant
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
| `upload` | Upload images to create assets or add variants |
| `generate` | Create a new asset through the website generation workflow |
| `refine` | Refine an existing variant through the website generation workflow |
| `derive` | Create a new asset from variant IDs and/or local image refs |
| `batch` | Generate multiple images and write a local run manifest |
| `runs` | List, inspect, and export local run manifests |
| `billing` | Billing sync status and management |

---

## Project Binding

Bind a filesystem workspace to a website space:

```bash
pnpm run cli init --space <space_id> [--env stage|production|local]
```

This writes `.inventory/config.json` with only the target environment and space
ID. It does not store assets, prompts, images, generation keys, or auth tokens.
Forge commands use this binding when `--space` or `--env` are omitted. Explicit
flags still override the project defaults.

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

Download an existing completed variant or direct image key to a local file:

```bash
pnpm run cli assets download VARIANT_ID -o references/variant.png
pnpm run cli assets download images/space/variant.png -o references/variant.png
```

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

Upload images to create new assets or add variants to existing assets.

### Create New Asset

```bash
pnpm run cli upload <file> --space <id> --name <name> [options]
```

### Add Variant to Existing Asset

```bash
pnpm run cli upload <file> --space <id> --asset <id>
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `<file>` | Yes | Path to image file |
| `--space <id>` | Yes | Target space ID |
| `--asset <id>` | * | Target asset ID (upload as new variant) |
| `--name <name>` | * | New asset name (creates asset + variant) |
| `--type <type>` | No | Asset type for new assets (default: `character`) |
| `--parent <id>` | No | Parent asset ID for new assets |
| `--env <env>` | No | `production`, `stage`, or `local` (default: `stage`) |
| `--local` | No | Shortcut for `--env local` |

\* Either `--asset` or `--name` is required.

**Supported formats:** `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp` (max 10MB)

**Examples:**
```bash
# Create a new character asset from an image
pnpm run cli upload hero.png --space abc123 --name "Hero Character"

# Create with specific type and parent
pnpm run cli upload sword.png --space abc123 --name "Sword" --type item --parent abc789

# Add a variant to an existing asset
pnpm run cli upload variant.jpg --space abc123 --asset def456

# Upload against local dev server
pnpm run cli upload hero.png --space abc123 --name "Hero" --local
```

---

## Forge Generation

The CLI can act as a ForgeTray controller for an existing website space. The
website remains authoritative for assets, variants, recipes, lineage, and R2
storage; the CLI sends generation requests and downloads completed images.
These generation commands are explicitly image-only and send `mediaKind: "image"`.

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

### Run Manifests

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
pnpm run cli billing --env stage
```

---

## Troubleshooting

### "Not logged in" Error

```bash
pnpm run cli login --env stage
```

### "Token expired" Error

```bash
pnpm run cli login --env stage
```
