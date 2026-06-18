# Make Effects

Make Effects is the project layer for CLI-first media generation.

Start with the fast loop you already like: use a shell, script, or coding agent to generate images, video, audio, speech, music, and sound effects. That works well until the project grows. Then you need to remember which prompt created which result, compare variants, keep source references attached, refine promising directions, and move the chosen media into the thing you are building.

Make Effects keeps that thread together. The `makefx` CLI gives agents and local workflows a command surface. The web app gives people a visual workspace for review, collaboration, variants, lineage, and production handoff.

## Agent Quick Start

```sh
npm install -g makefx
makefx login
makefx spaces create "My Game Assets" --init
makefx generate "A market background" --name "Market" --type scene -o art/market.png
makefx audio sfx generate "Magic pickup" --name "Pickup" -o audio/pickup.wav
makefx video generate "Looping idle animation" --name "Idle" --type animation -o video/idle.mp4
makefx assets --json
```

## Public Documentation

- [Quickstart](https://makefx.app/docs/quickstart.md)
- [Core Concepts](https://makefx.app/docs/concepts.md)
- [CLI Reference](https://makefx.app/docs/cli.md)
- [Production Handoff](https://makefx.app/docs/production-handoff.md)
- [LLM index](https://makefx.app/llms.txt)
- [Full LLM context](https://makefx.app/llms-full.txt)
