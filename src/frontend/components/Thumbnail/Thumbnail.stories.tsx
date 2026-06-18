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

export const Badges: Story = () => (
  <div className={layout.inlineCluster}>
    <Labeled label="Active">
      <Thumbnail variant={makeVariant({ status: 'processing' })} size="md" showBadges isActive />
    </Labeled>
    <Labeled label="Starred">
      <Thumbnail variant={makeVariant({ status: 'processing', starred: true })} size="md" showBadges />
    </Labeled>
  </div>
);
