// ============================================================================
// Templates
// ============================================================================

const ROTATION_CAMERA_SPECS: Record<string, string> = {
  // Turnaround directions
  'front': 'camera at eye level, facing directly forward, 0° rotation',
  'back': 'camera at eye level, facing directly backward, 180° rotation',
  'side': 'camera at eye level, facing directly to the side, 90° rotation',
  '3/4-front': 'camera at eye level, 45° from front, three-quarter front view',
  '3/4-back': 'camera at eye level, 45° from back, three-quarter rear view',
  // Compass directions (4-directional and 8-directional)
  'S': 'camera facing the subject from the south, front-facing view',
  'N': 'camera facing the subject from the north, rear view',
  'E': 'camera facing the subject from the east, right-side view',
  'W': 'camera facing the subject from the west, left-side view',
  'SE': 'camera facing the subject from the south-east, front-right three-quarter view',
  'SW': 'camera facing the subject from the south-west, front-left three-quarter view',
  'NE': 'camera facing the subject from the north-east, rear-right three-quarter view',
  'NW': 'camera facing the subject from the north-west, rear-left three-quarter view',
};

const NEGATIVE_PROMPTS = {
  characters: 'No extra fingers, hands, or limbs. No floating body parts. No watermarks or text overlays.',
  all: 'No watermarks. No artist signatures. No UI elements.',
};

// ============================================================================
// PromptBuilder
// ============================================================================

export class PromptBuilder {
  private parts: string[] = [];

  withStyle(description: string): this {
    this.parts.push(`[Style: ${description}]`);
    return this;
  }

  withReferences(refs: Array<{ label: string }>): this {
    for (let i = 0; i < refs.length; i++) {
      this.parts.push(`Image ${i + 1}: ${refs[i].label}`);
    }
    return this;
  }

  withConstraints(negatives: string[]): this {
    if (negatives.length > 0) {
      this.parts.push(`Avoid: ${negatives.join(', ')}`);
    }
    return this;
  }

  withRotationContext(
    completedViews: Array<{ direction: string }>,
    direction: string,
    subject: string
  ): this {
    this.parts.push('You are creating a consistent multi-view character reference sheet.');
    this.parts.push('The reference images show the same subject from previously generated angles.');
    for (let i = 0; i < completedViews.length; i++) {
      this.parts.push(`Image ${i + 1}: ${subject} ${completedViews[i].direction} view`);
    }

    const cameraSpec = ROTATION_CAMERA_SPECS[direction];
    const cameraLine = cameraSpec ? ` (${cameraSpec})` : '';
    this.parts.push(`\nGenerate: Show the EXACT SAME ${subject} from the ${direction} view${cameraLine}.`);
    this.parts.push(`IDENTICAL design: same ${subject}, same proportions, same color palette.`);
    this.parts.push('- Maintain identical design, proportions, colors, clothing, and style');
    this.parts.push('- Keep the same level of detail and artistic rendering');
    this.parts.push('- Neutral standing/display pose');
    this.parts.push('- Plain background');
    this.parts.push('- Match the exact art style of all reference images');

    return this;
  }

  withTheme(prompt: string): this {
    this.parts.push(`Theme: ${prompt}`);
    return this;
  }

  build(): string {
    return this.parts.join('\n');
  }
}

export { NEGATIVE_PROMPTS, ROTATION_CAMERA_SPECS };
