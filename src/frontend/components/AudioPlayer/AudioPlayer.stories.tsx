import type { Story, StoryDefault } from '../../component-stories/ladle-types';
import layout from '../../component-stories/story-layout.module.css';
import { AudioPlayer } from './AudioPlayer';

export default { title: 'Components / AudioPlayer' } satisfies StoryDefault;

// A tiny silent WAV so the player has real, loadable metadata in the gallery
// without depending on a backend media route.
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

const Labeled = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className={layout.row}>
    <span className={layout.label}>{label}</span>
    {children}
  </div>
);

export const Default: Story = () => (
  <div className={layout.inlineCluster}>
    <Labeled label="Audio player">
      <AudioPlayer src={SILENT_WAV} />
    </Labeled>
  </div>
);
