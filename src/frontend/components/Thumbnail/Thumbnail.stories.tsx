import type { Story, StoryDefault } from '../../component-stories/ladle-types';
import layout from '../../component-stories/story-layout.module.css';
import { makeVariant } from '../../component-stories/fixtures';
import { Thumbnail } from './Thumbnail';

export default { title: 'Components / Thumbnail' } satisfies StoryDefault;

const Labeled = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className={layout.row}>
    <span className={layout.label}>{label}</span>
    {children}
  </div>
);

// Lifecycle states render fully via CSS (no backend image needed).
export const States: Story = () => (
  <div className={layout.inlineCluster}>
    <Labeled label="Empty">
      <Thumbnail variant={null} size="md" />
    </Labeled>
    <Labeled label="Queued">
      <Thumbnail variant={makeVariant({ status: 'pending' })} size="md" />
    </Labeled>
    <Labeled label="Generating">
      <Thumbnail variant={makeVariant({ status: 'processing' })} size="md" />
    </Labeled>
    <Labeled label="Failed">
      <Thumbnail
        variant={makeVariant({ status: 'failed', error_message: 'Generation timed out' })}
        size="md"
        onRetry={() => {}}
      />
    </Labeled>
  </div>
);

export const Sizes: Story = () => (
  <div className={layout.inlineCluster}>
    {(['xs', 'sm', 'md', 'lg'] as const).map((size) => (
      <Labeled key={size} label={size}>
        <Thumbnail variant={makeVariant({ status: 'processing' })} size={size} />
      </Labeled>
    ))}
  </div>
);

// Badges render only for ready (completed) variants. Use completed AUDIO
// variants: they satisfy isVariantReady (media_key set) so the badges show,
// while getVariantThumbnailUrl stays undefined (no image_key) — avoiding a
// broken /api/images request the static preview can't serve.
export const Badges: Story = () => (
  <div className={layout.inlineCluster}>
    <Labeled label="Active">
      <Thumbnail
        variant={makeVariant({ media_kind: 'audio', status: 'completed', media_key: 'audio-demo.mp3' })}
        size="md"
        showBadges
        isActive
      />
    </Labeled>
    <Labeled label="Starred">
      <Thumbnail
        variant={makeVariant({ media_kind: 'audio', status: 'completed', media_key: 'audio-demo.mp3', starred: true })}
        size="md"
        showBadges
      />
    </Labeled>
  </div>
);

// Completed image variants resolve their thumbnail to /api/images/…; the
// style-reference capture route-mocks that path with a placeholder, so this
// renders in the gallery (the dev `stories` server shows a broken image).
export const Completed: Story = () => {
  const variant = makeVariant({
    status: 'completed',
    image_key: 'demo.png',
    thumb_key: 'demo-thumb.png',
    media_width: 400,
    media_height: 400,
  });
  return (
    <div className={layout.inlineCluster}>
      {(['sm', 'md', 'lg'] as const).map((size) => (
        <Labeled key={size} label={size}>
          <Thumbnail variant={variant} size={size} showBadges />
        </Labeled>
      ))}
    </div>
  );
};

// Audio variants: the waveform player fills the card at canvas size (fill),
// while compact tiles (sm) fall back to the music glyph.
export const Audio: Story = () => {
  const audio = makeVariant({
    media_kind: 'audio',
    status: 'completed',
    media_key: 'voice-clip.mp3',
    media_size_bytes: 1_280_000,
  });
  return (
    <div className={layout.inlineCluster}>
      <Labeled label="canvas (fill)">
        <div style={{ width: 180, height: 180 }}>
          <Thumbnail variant={audio} size="fill" showAudioControls showBadges isActive />
        </div>
      </Labeled>
      <Labeled label="compact (sm)">
        <Thumbnail variant={audio} size="sm" showAudioControls />
      </Labeled>
    </div>
  );
};
