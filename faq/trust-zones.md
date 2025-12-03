# Trust Zones

## What are Trust Zones?

Trust Zones is a safety feature that controls how the AI assistant executes actions on your behalf. It distinguishes between safe operations that can run automatically and potentially costly operations that require your approval.

## How it works

When you chat with the Forge Assistant in **Actor mode**, it may suggest taking actions like generating new assets, refining existing ones, or organizing your tray. These actions fall into two categories:

### Safe Operations (Auto-execute)

These operations run automatically without asking for permission:

- **Search assets** - Finding assets by name or type
- **Describe image** - Analyzing what's in a variant image
- **Compare variants** - Comparing multiple variants side-by-side
- **Add to tray** - Adding an asset to the Forge Tray
- **Remove from tray** - Removing an asset from the tray
- **Clear tray** - Emptying the Forge Tray
- **Set prompt** - Setting the generation prompt

These are safe because they don't consume credits and don't create permanent changes.

### Generating Operations (Require Approval)

These operations require your explicit approval before running:

- **Generate asset** - Creating a new asset from a prompt
- **Derive asset** - Creating a new asset using references as inspiration
- **Refine asset** - Adding a new variant to an existing asset
- **Create plan** - Creating a multi-step workflow

These require approval because they consume AI credits and create permanent assets.

## The Approval Panel

When the assistant suggests a generating operation, you'll see an **Approval Panel** appear in the chat sidebar showing:

- The action description (e.g., "Generate new asset from prompt")
- The prompt being used (truncated preview)
- **Approve (✓)** button - Execute the action
- **Reject (✕)** button - Cancel the action

If multiple actions are pending, you'll also see:
- **Approve All** - Execute all pending actions
- **Reject All** - Cancel all pending actions

## Configuring Trust Zones

You can customize Trust Zone behavior in the **Preferences Panel** (gear icon in the chat header):

### Auto-execute safe operations
When enabled (default), safe operations like search and describe run automatically. Disable this if you want to approve every action.

### Auto-approve low-cost generations
When enabled, quick refinements may run without approval. This is disabled by default and is a planned feature for future releases.

## Best Practices

1. **Review before approving** - Take a moment to read the prompt and make sure it's what you want
2. **Use Reject** - If the assistant misunderstood your request, reject and clarify
3. **Bulk approve carefully** - "Approve All" is convenient but make sure you've reviewed each action
4. **Check your preferences** - Adjust the trust settings to match your comfort level

## Technical Details

Trust Zones are implemented at the backend level:

- **File**: `src/backend/services/trustLevels.ts`
- Tools are classified by a `TrustLevel` enum: `'safe' | 'generating' | 'planning'`
- The `shouldAutoExecute()` function determines if a tool runs automatically
- Claude's responses are parsed and tool calls are split into safe (auto-execute) and generating (pending approval) queues

The frontend maintains pending approvals in the chat store:
- **File**: `src/frontend/stores/chatStore.ts`
- `pendingApprovals` array tracks actions awaiting user decision
- `approveApproval()` and `rejectApproval()` handle user choices
