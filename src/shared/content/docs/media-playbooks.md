# Media Playbooks

Use these notes when a project has crossed the messy middle: a dozen promising outputs, three styles that almost match, and no clear handoff path.

Write prompts the way you would brief a freelancer: show the references, name the job, and say what must not change. The exact reference type changes by medium:

1. For images, lock a reusable visual reference first.
2. For video, make the keyframe right before asking for motion.
3. For audio, reuse stable voices, speaker names, and sound briefs. Audio generation does not accept reference assets today.
4. Change one variable per turn.
5. Keep variants and prompt history attached to the project.
6. Move only the chosen result into production handoff.

## Image work

Start with identity and style before final composition.

- Build a reusable character or prop reference before asking for a finished scene.
- Use a rotation or turnaround set when the asset must stay consistent across angles.
- Keep a small number of style references for a space instead of mixing many aesthetics.
- Use `derive` when combining character, background, and style references.
- Use `refine` for one deliberate change while stating what must stay unchanged.

See [Image Playbook](/docs/image-playbook).

## Video work

Make keyframes first, then animate them.

- Generate or derive a locked image keyframe before asking Veo for motion.
- Use image references to preserve character, setting, and composition.
- Prompt with camera movement, subject, action, context, style, and sound.
- Use production metadata when a clip belongs on a timeline.
- Export production records instead of handing off loose files.

See [Video Playbook](/docs/video-playbook).

## Audio work

Pick the right audio mode and reuse identity cues.

- Use `speech` for one narrator or voiceover.
- Use `dialogue` for multi-speaker scripts with stable `Speaker:` names.
- Use `music` for beds, cues, stings, and loops.
- Use `sfx` for one-off sound effects tied to visible actions.
- Treat a selected voice like a reference asset.

See [Audio Playbook](/docs/audio-playbook).

## CLI loop

```sh
makefx generate "A market background" --name "Market" --type scene -o art/market.png
makefx derive --refs CHARACTER_VARIANT_ID,BACKGROUND_VARIANT_ID \
  "Place the character in the market, keep design and colors exact" \
  --name "Hero In Market" --type scene -o keyframes/hero-market.png
makefx video derive --refs KEYFRAME_VARIANT_ID \
  "Slow dolly-in, subtle crowd movement, keep the hero centered" \
  --production-id episode-01 --shot-id shot-001 \
  --scene-label "Market" --timeline-start-ms 0 --duration-ms 8000 \
  -o video/episode-01/shot-001.mp4
```

To choose image, video, and audio settings, see [Model & Parameter Selection](/docs/model-and-parameter-selection).
