# Inventory CLI

Command-line interface for the Inventory Forge platform. Provides space management, real-time event monitoring, image uploading, and billing management.

## Quick Start

```bash
# 1. Login first (if not already)
npm run cli login --env stage

# 2. Create or list spaces
npm run cli spaces                          # List all spaces
npm run cli spaces create "My Game Assets"  # Create new space

# 3. Listen to real-time events (in a separate terminal)
npm run cli listen --space YOUR_SPACE_ID

# 4. Upload an image to create a new asset
npm run cli upload hero.png --space YOUR_SPACE_ID --name "Hero Character"

# 5. Upload a variant to an existing asset
npm run cli upload variant.jpg --space YOUR_SPACE_ID --asset ASSET_ID
```

## Commands Overview

| Command | Description |
|---------|-------------|
| `login` | Authenticate with the API |
| `logout` | Remove stored credentials |
| `spaces` | List, view, or create spaces |
| `listen` | Connect to WebSocket and stream all events |
| `upload` | Upload images to create assets or add variants |
| `billing` | Billing sync status and management |

---

## Spaces

Manage your spaces (workspaces for organizing assets).

### List Spaces

```bash
npm run cli spaces                    # Simple list
npm run cli spaces --details          # With asset counts
npm run cli spaces --id <space_id>    # Details for specific space
```

### Create Space

```bash
npm run cli spaces create "My Space Name"
npm run cli spaces create --name "My Space Name"
```

---

## Listen Mode

Connect to a space's WebSocket and stream all events in real-time. Useful for debugging, monitoring, and understanding the event flow.

```bash
npm run cli listen --space <space_id>           # Pretty-printed output
npm run cli listen --space <space_id> --json    # Raw JSON (for piping)
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
npm run cli upload <file> --space <id> --name <name> [options]
```

### Add Variant to Existing Asset

```bash
npm run cli upload <file> --space <id> --asset <id>
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
npm run cli upload hero.png --space abc123 --name "Hero Character"

# Create with specific type and parent
npm run cli upload sword.png --space abc123 --name "Sword" --type item --parent abc789

# Add a variant to an existing asset
npm run cli upload variant.jpg --space abc123 --asset def456

# Upload against local dev server
npm run cli upload hero.png --space abc123 --name "Hero" --local
```

---

## Billing

View billing sync status and manage usage.

```bash
npm run cli billing --env stage
```

---

## Troubleshooting

### "Not logged in" Error

```bash
npm run cli login --env stage
```

### "Token expired" Error

```bash
npm run cli login --env stage
```
