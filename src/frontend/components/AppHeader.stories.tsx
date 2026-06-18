import type { Story, StoryDefault } from '../component-stories/ladle-types';
import { AppHeader } from './AppHeader';
import { HeaderNav } from './HeaderNav';

export default { title: 'Components / AppHeader' } satisfies StoryDefault;

const Brand = () => <strong style={{ fontSize: 'var(--font-size-h3)' }}>Make Effects</strong>;
const Title = () => <span style={{ color: 'var(--color-text-muted)' }}>My Space</span>;

export const Full: Story = () => (
  <AppHeader
    leftSlot={<Brand />}
    centerSlot={<Title />}
    rightSlot={<HeaderNav userName="Ada Lovelace" userEmail="ada@example.com" />}
  />
);

export const Loading: Story = () => (
  <AppHeader leftSlot={<Brand />} centerSlot={<Title />} rightSlot={<HeaderNav userName="Ada" />} isLoading />
);

export const Minimal: Story = () => <AppHeader leftSlot={<Brand />} />;
