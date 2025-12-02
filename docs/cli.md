# Inventory CLI

Command-line interface for the Inventory Forge platform. Provides space management, real-time event monitoring, and step-by-step chat workflow for testing and iteration.

## Quick Start

```bash
# 1. Login first (if not already)
npm run cli login --env stage

# 2. Create or list spaces
npm run cli spaces                          # List all spaces
npm run cli spaces create "My Game Assets"  # Create new space

# 3. Listen to real-time events (in a separate terminal)
npm run cli listen --space YOUR_SPACE_ID

# 4. Send a message to the chat service
npm run cli chat send "Create a fantasy warrior with silver armor" \
  --space YOUR_SPACE_ID --state ./test/warrior.json

# 5. Inspect what Claude plans to do
npm run cli chat show --state ./test/warrior.json --section gemini

# 6. Execute when satisfied
npm run cli chat execute --state ./test/warrior.json
```

## Commands Overview

| Command | Description |
|---------|-------------|
| `login` | Authenticate with the API |
| `logout` | Remove stored credentials |
| `spaces` | List, view, or create spaces |
| `listen` | Connect to WebSocket and stream all events |
| `chat` | Interactive chat workflow with Claude |
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

## Chat Workflow

CLI chat interface that simulates the web chat experience for testing and faster iteration. Provides step-by-step execution with debugging features like file-based state persistence and human-readable logs.

**Key differences from web:**
- **Explicit step-by-step workflow** - Review before executing
- **Markdown logs** - Human-readable `.log.md` files alongside JSON state
- **Same operations** - No special commands, works like web (prompt-driven)

## Workflow

The CLI follows a **checkpoint-based workflow** where each command saves state to a file:

```
┌─────────────────────────────────────────────────────────────────┐
│                         WORKFLOW                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. SEND MESSAGE                                                 │
│     └─> Calls chat API, saves response to state file             │
│         (does NOT execute any actions)                           │
│                                                                  │
│  2. EVALUATE                                                     │
│     └─> Inspect state file: tool calls, Gemini prompts, params   │
│         Decide if the AI's plan is acceptable                    │
│                                                                  │
│  3. EXECUTE (optional)                                           │
│     └─> Run pending actions, wait for jobs, save results         │
│                                                                  │
│  4. REPEAT                                                       │
│     └─> Send next message to continue conversation               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Commands

### `send` - Send a Chat Message

Sends a message to the chat service and saves the response. **Does not execute any actions.**

```bash
npm run cli chat send <message> --space <id> --state <file> [options]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `<message>` | Yes | The message to send |
| `--space <id>` | Yes* | Space ID (*only required for new conversation) |
| `--state <file>` | Yes | Path to state file (created if doesn't exist) |
| `--mode <mode>` | No | `advisor` or `actor` (default: `actor`) |
| `--env <env>` | No | `production`, `stage`, or `local` (default: `stage`) |
| `--local` | No | Shortcut for `--env local` |

**Examples:**
```bash
# Start new conversation
npm run cli chat send "Create a mage character with blue robes" \
  --space space_abc123 --state ./test/mage.json

# Continue existing conversation (space ID from state file)
npm run cli chat send "Add a glowing staff" --state ./test/mage.json

# Use advisor mode (read-only, no tool calls)
npm run cli chat send "What characters do I have?" \
  --state ./test/mage.json --mode advisor
```

### `show` - Display State for Evaluation

Pretty-prints the state file for human evaluation.

```bash
npm run cli chat show --state <file> [--section <name>]
```

**Sections:**
| Section | Description |
|---------|-------------|
| `all` | Show everything (default) |
| `meta` | Space ID, environment, timestamps |
| `conversation` | Chat history and current context |
| `pending` | Actions waiting to be executed |
| `executed` | Actions that have been run with results |
| `artifacts` | Created assets, variants, and jobs |
| `gemini` | **Gemini prompts** - the exact prompts sent to image generation |

**Examples:**
```bash
# Show everything
npm run cli chat show --state ./test/mage.json

# Show only pending actions with full details
npm run cli chat show --state ./test/mage.json --section pending

# Show Gemini prompts (most useful for evaluation)
npm run cli chat show --state ./test/mage.json --section gemini

# Show what was created
npm run cli chat show --state ./test/mage.json --section artifacts
```

### `execute` - Execute Pending Actions

Executes pending actions (tool calls) via WebSocket and waits for generation to complete.

```bash
npm run cli chat execute --state <file> [options]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `--state <file>` | Yes | Path to state file |
| `--action <id>` | No | Execute only specific action by ID |
| `--env <env>` | No | `production`, `stage`, or `local` (default: `stage`) |
| `--local` | No | Shortcut for `--env local` |

**Examples:**
```bash
# Execute all pending actions
npm run cli chat execute --state ./test/mage.json

# Execute specific action only
npm run cli chat execute --state ./test/mage.json --action approval_abc123

# Execute against local dev server
npm run cli chat execute --state ./test/mage.json --local
```

## State File Format

The state file is a JSON document that captures the entire conversation state:

```json
{
  "meta": {
    "version": "1.0",
    "createdAt": "2024-01-15T14:32:01Z",
    "updatedAt": "2024-01-15T14:35:22Z",
    "spaceId": "space_abc123",
    "spaceName": "My Test Space",
    "environment": "stage"
  },

  "conversation": {
    "history": [
      { "role": "user", "content": "Create a warrior with silver armor" },
      { "role": "assistant", "content": "I'll create a warrior..." }
    ],
    "context": {
      "forgeContext": { "operation": "generate", "slots": [], "prompt": "" },
      "viewingContext": { "type": "asset", "assetId": "...", "assetName": "..." }
    }
  },

  "pendingActions": [
    {
      "id": "approval_xyz",
      "tool": "generate_asset",
      "params": {
        "name": "Silver Warrior",
        "type": "character",
        "prompt": "A heroic warrior in gleaming silver plate armor..."
      },
      "geminiRequest": {
        "model": "gemini-2.0-flash-preview-image-generation",
        "prompt": "A heroic warrior in gleaming silver plate armor...",
        "config": {
          "responseModalities": ["image", "text"],
          "aspectRatio": "1:1"
        }
      }
    }
  ],

  "executedActions": [],

  "artifacts": {
    "assets": [],
    "variants": [],
    "jobs": []
  }
}
```

## Evaluation Guide

### What to Check Before Executing

1. **Tool Selection** - Did Claude choose the right tool?
   - `generate_asset` - Create new asset from scratch
   - `refine_asset` - Modify existing asset
   - `combine_assets` - Merge multiple references

2. **Asset Name & Type** - Are they appropriate?
   ```
   name: "Silver Warrior"
   type: "character"
   ```

3. **Gemini Prompt** - This is the most important part!
   ```bash
   npm run cli chat show --state ./test/warrior.json --section gemini
   ```

   Check:
   - Does it capture your intent?
   - Is it detailed enough?
   - Does it include relevant style cues?
   - Are there any hallucinations?

4. **Config** - Generation settings
   - `aspectRatio` - 1:1, 16:9, 9:16, etc.
   - `model` - Which Gemini model

### Example Evaluation Session

```bash
$ npm run cli chat send "Create an elven archer with silver hair" \
    --space space_123 --state ./test/elf.json

Response type: action
Message: I'll create an elven archer character with silver hair for you.

Pending actions: 1
  - generate_asset: Elven Archer

State saved to: ./test/elf.json

$ npm run cli chat show --state ./test/elf.json --section gemini

=== GEMINI PROMPTS ===

○ [pending] generate_asset

  Model: gemini-2.0-flash-preview-image-generation

  Prompt:
  ┌──────────────────────────────────────────────────────────────────────
  │ An elegant elven archer with flowing silver hair, pointed ears, and
  │ keen eyes. They wear forest-green leather armor with intricate leaf
  │ patterns. A finely crafted longbow is held ready. Fantasy
  │ illustration style, detailed character art.
  └──────────────────────────────────────────────────────────────────────

  Config:
    responseModalities: ["image", "text"]
    aspectRatio: 1:1

# Looks good! Execute it:
$ npm run cli chat execute --state ./test/elf.json

Connecting to space space_123...
[WebSocketClient] Connected to space space_123

Executing 1 action(s)...

Executing: generate_asset
  ID: approval_abc123
  Name: Elven Archer
  Prompt: An elegant elven archer with flowing silver hair...
  Waiting for generation to complete...
  ✓ Completed
  Variant: abc123-def456-...
  Asset: xyz789-...

State updated: ./test/elf.json
```

## Tips

### Testing Different Scenarios

Create separate state files for different test scenarios:

```bash
# Character generation
npm run cli chat send "Create a dwarf blacksmith" \
  --space space_123 --state ./test/dwarf.json

# Scene generation
npm run cli chat send "Create a mystical forest clearing" \
  --space space_123 --state ./test/forest.json

# Refinement flow
npm run cli chat send "Change the armor to gold" \
  --state ./test/warrior.json
```

### Comparing Prompts

Save state files to compare how different requests produce different prompts:

```bash
# Request A
npm run cli chat send "Create a warrior" \
  --space space_123 --state ./test/compare-a.json

# Request B (more specific)
npm run cli chat send "Create a medieval knight in full plate armor, heroic pose" \
  --space space_123 --state ./test/compare-b.json

# Compare the Gemini prompts
npm run cli chat show --state ./test/compare-a.json --section gemini
npm run cli chat show --state ./test/compare-b.json --section gemini
```

### Testing Plan Creation

For complex requests, Claude may create a multi-step plan:

```bash
$ npm run cli chat send "Create a party of 3 fantasy characters: a warrior, mage, and rogue" \
    --space space_123 --state ./test/party.json

Response type: plan
Message: I'll create a party of 3 characters for you...

Plan: Create fantasy adventuring party
Steps: 3
  1. [generate_asset] Create warrior character
  2. [generate_asset] Create mage character
  3. [generate_asset] Create rogue character
```

### Local Development

Test against a local dev server:

```bash
npm run cli chat send "Test message" \
  --space space_123 --state ./test/local.json --local
```

## Troubleshooting

### "Not logged in" Error

```bash
npm run cli login --env stage
```

### "Token expired" Error

```bash
npm run cli login --env stage
```

### State File Not Found

Make sure to use `--space` for the first message to create the state file:

```bash
npm run cli chat send "Hello" --space YOUR_SPACE_ID --state ./test/new.json
```

### Viewing Raw State

The state file is plain JSON - you can view it directly:

```bash
cat ./test/warrior.json | jq .
```

Or open in your editor to inspect/modify.
