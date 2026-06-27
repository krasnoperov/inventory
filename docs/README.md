# Documentation

Technical documentation for Make Effects.

## Playbooks

Reference-backed guidance for getting good results — characters, styles, scenes,
and consistency across images, video, and audio.

| Playbook | Description |
|----------|-------------|
| [playbooks/README.md](./playbooks/README.md) | Index and shared principles |
| [playbooks/images.md](./playbooks/images.md) | Personages, style references, scenes, composition, editing, consistency |
| [playbooks/video.md](./playbooks/video.md) | Keyframes-first workflow, references, cinematography prompts, handoff |
| [playbooks/audio.md](./playbooks/audio.md) | Speech, dialogue, music, SFX; the Gemini-native audio path |

## Guides

| Document | Description |
|----------|-------------|
| [architecture.md](./architecture.md) | System overview, data storage, key flows |
| [domain.md](./domain.md) | Core concepts: assets, variants, lineage, forge tray |
| [media-cdn.md](./media-cdn.md) | R2 custom-domain CDN setup for immutable image previews |
| [style-and-batch.md](./style-and-batch.md) | Style presets, style reference collections, and batch generation |
| [model-and-parameter-selection.md](./model-and-parameter-selection.md) | Which model and parameters to pick for images, video, and audio |
| [design.md](./design.md) | Visual design system and patterns |
| [billing.md](./billing.md) | Polar metering, Paid Generation, and provider-cost accounting |
| [byok-key-broker.md](./byok-key-broker.md) | Broker custody boundary for BYOK provider keys |
| [byok-rotation-runbook.md](./byok-rotation-runbook.md) | DEK/KEK rotation staging, production, rollback, and verification |
| [cli.md](./cli.md) | Command-line interface usage |
| [cli-generation.md](./cli-generation.md) | CLI-driven Forge generation, asset inspection, and downloads |
| [cli-media-production-cookbook.md](./cli-media-production-cookbook.md) | End-to-end CLI cookbook for image, audio, video, and podcast production |
| [persistent-chat.md](./persistent-chat.md) | AI chat system and message flows |
| [websocket.md](./websocket.md) | WebSocket message contract |
| [rotation-and-tiles.md](./rotation-and-tiles.md) | Rotation views and tile set pipelines |
| [space-sharing-rollout.md](./space-sharing-rollout.md) | Stage and production smoke checklist for Space sharing |

## Quick Links

- **PRD:** [`../PRD.md`](../PRD.md) — Product requirements and feature checklist
- **Setup:** [`../CLAUDE.md`](../CLAUDE.md) — Development setup and commands
