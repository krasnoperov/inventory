# Forge Assistant Features

This directory contains user-facing documentation for the Forge Assistant AI features.

## Current Features

### [Trust Zones](./trust-zones.md)
Control how the AI assistant executes actions. Safe operations run automatically, while generating operations require your approval. Learn how to configure trust settings and use the approval panel.

### [Memory & Personalization](./memory-personalization.md)
The assistant learns from your successful prompts to provide better suggestions over time. Manage your learned patterns, set style preferences, and configure personalization settings.

## Planned Features

### Autonomous Workflows
Multi-step plans with checkpointing and rollback capabilities. The assistant will be able to execute complex creative workflows while tracking progress and allowing you to undo any step.

See: [Implementation Plan](../docs/AUTONOMOUS_WORKFLOWS_PLAN.md)

### Batch Operations
Queue multiple generation jobs and manage them as a group. Create collections of assets, monitor progress, and pause/resume batch operations.

See: [Implementation Plan](../docs/BATCH_OPERATIONS_PLAN.md)

## Quick Reference

| Feature | Status | Key Files |
|---------|--------|-----------|
| Trust Zones | ✅ Implemented | `trustLevels.ts`, `ChatSidebar.tsx` |
| Memory & Personalization | ✅ Implemented | `memoryService.ts`, `PreferencesPanel.tsx` |
| Autonomous Workflows | 📋 Planned | See plan document |
| Batch Operations | 📋 Planned | See plan document |

## Getting Help

- **In-app**: Click the gear icon (⚙) in the chat sidebar to access preferences
- **Technical docs**: See `docs/` directory for architecture and implementation details
- **Issues**: Report bugs or request features on GitHub
