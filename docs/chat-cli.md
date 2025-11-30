# Chat CLI

CLI chat interface that simulates the web chat experience for testing and faster iteration. Provides step-by-step execution with debugging features like file-based state persistence and human-readable logs.

**Key differences from web:**
- **Explicit step-by-step workflow** - Review before executing
- **Markdown logs** - Human-readable `.log.md` files alongside JSON state
- **Same operations** - No special commands, works like web (prompt-driven)

## Quick Start

```bash
# 1. Login first (if not already)
npm run cli login --env stage

# 2. Send a message to the chat service
npm run cli chat send "Create a fantasy warrior with silver armor" \
  --space YOUR_SPACE_ID --state ./test/warrior.json

# 3. Inspect what Claude plans to do
npm run cli chat show --state ./test/warrior.json --section gemini

# Or check the human-readable log
cat ./test/warrior.log.md

# 4. Execute when satisfied
npm run cli chat execute --state ./test/warrior.json

# 5. Continue the conversation
npm run cli chat send "Give them a flaming sword" --state ./test/warrior.json
```

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

Executes pending actions (tool calls) and waits for generation jobs to complete.

```bash
npm run cli chat execute --state <file> [options]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `--state <file>` | Yes | Path to state file |
| `--action <id>` | No | Execute only specific action by ID |
| `--wait` | No | Wait for jobs to complete (default: `true`) |
| `--timeout <ms>` | No | Max wait time in milliseconds (default: `120000`) |

**Examples:**
```bash
# Execute all pending actions
npm run cli chat execute --state ./test/mage.json

# Execute specific action only
npm run cli chat execute --state ./test/mage.json --action approval_abc123

# Don't wait for generation to complete
npm run cli chat execute --state ./test/mage.json --wait false
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

Executing: generate_asset
  ID: approval_abc123
  Name: Elven Archer
  Prompt: An elegant elven archer with flowing silver hair...
  Job: job_xyz789
  Waiting for completion...
  ✓ Completed
  Variant: variant_def456

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
