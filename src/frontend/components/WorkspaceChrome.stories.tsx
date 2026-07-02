import type { Story, StoryDefault } from '../component-stories/ladle-types';
import { WorkspaceChrome } from './WorkspaceChrome';
import { HeaderNav } from './HeaderNav';

export default { title: 'Components / WorkspaceChrome' } satisfies StoryDefault;

const Brand = () => <strong style={{ fontSize: 'var(--font-size-h3)' }}>Make Effects</strong>;
const StatusPill = () => (
  <span style={{ color: 'var(--color-success)', fontSize: 'var(--font-size-small)' }}>● Synced</span>
);

export const Full: Story = () => (
  <WorkspaceChrome
    leftSlot={<Brand />}
    centerSlot={<span style={{ color: 'var(--color-text-muted)' }}>Space</span>}
    rightSlot={<HeaderNav userName="Ada Lovelace" userEmail="ada@example.com" />}
    statusSlot={<StatusPill />}
  />
);

export const Loading: Story = () => (
  <WorkspaceChrome leftSlot={<Brand />} rightSlot={<HeaderNav userName="Ada" />} isLoading />
);
