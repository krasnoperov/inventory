import type { Story, StoryDefault } from '../component-stories/ladle-types';
import layout from '../component-stories/story-layout.module.css';
import { HeaderNav } from './HeaderNav';

export default { title: 'Components / HeaderNav' } satisfies StoryDefault;

const Labeled = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className={layout.row}>
    <span className={layout.label}>{label}</span>
    {children}
  </div>
);

export const Variants: Story = () => (
  <div className={layout.stack}>
    <Labeled label="Name + email">
      <HeaderNav userName="Ada Lovelace" userEmail="ada@example.com" />
    </Labeled>
    <Labeled label="Email only">
      <HeaderNav userName={null} userEmail="ada@example.com" />
    </Labeled>
    <Labeled label="Without dashboard link">
      <HeaderNav userName="Ada Lovelace" showDashboard={false} />
    </Labeled>
  </div>
);
