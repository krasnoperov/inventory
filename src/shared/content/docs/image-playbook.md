# Image Playbook

The model will not remember your robot for you. Give it a reference, name what that reference is for, and reuse it.

## Build the reusable asset first

For a character, prop, or UI object that must appear more than once, make a reference asset before making a finished scene.

- Generate a clean seed variant.
- Use rotation or turnaround flows when you need multiple angles.
- Keep the completed reference in the same space as later variants.
- Reuse that reference in `derive` and `refine` calls instead of recreating it from memory.

```sh
makefx generate "A felt-craft robot explorer, small brown backpack, friendly" \
  --name "Robot Explorer" --type character -o characters/robot.png
```

## Keep style anchored

A space-level style is the project's house style: short, coherent, and backed by a few reference images. If a single asset needs a genuinely different look, disable or override style for that request rather than fighting the shared style with contradictory words.

## Use a prompt skeleton

For scenes, write concrete prompts with:

- subject
- action
- location
- composition
- style

Example:

```text
A weathered dwarven blacksmith hammering a glowing blade on an anvil, sparks flying, in a dim stone forge with hanging tools in the background. Medium shot, low angle, painterly fantasy illustration, warm rim lighting.
```

Prefer positive framing. Say "an empty street" rather than "no cars." Name materials, camera angle, and lighting when they matter.

## Combine references by role

When using several references, tell the model what each one is for:

```sh
makefx derive \
  --refs CHARACTER_VARIANT_ID,BACKGROUND_VARIANT_ID \
  --name "Hero In Market" --type scene \
  "Use the first reference for the character and the second reference for the market background. Keep the character design, colors, and proportions exact. Cinematic 16:9 composition." \
  -o keyframes/hero-market.png
```

The public generation path defaults to the Pro image model, which supports multi-reference composition. The fast image model exists for service and internal paths; it is useful for quick drafts but only supports one reference.

## Edit one thing at a time

Use `refine` for a precise change, and say what must remain fixed:

```sh
makefx refine --variant BACKGROUND_VARIANT_ID \
  "Add hanging shop signs and more foreground depth. Keep the same camera angle, lighting, and color palette." \
  -o images/market-v2.png
```

Change pose, outfit, background, or lighting one at a time. This keeps drift visible and recoverable.

## Quick reference

| Goal | Do this |
|-|-|
| Reusable character | Build a reference or turnaround first |
| Consistent project look | Set a space style |
| Character plus background | `derive --refs A,B` and name each role |
| Small revision | `refine` and state what stays unchanged |
| Many references | Use the Pro model and stay within reference limits |

See [Model & Parameter Selection](/docs/model-and-parameter-selection) to choose the image path that supports your references, aspect ratio, and quality target.
