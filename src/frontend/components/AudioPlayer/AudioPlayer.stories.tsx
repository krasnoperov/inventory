import type { Story, StoryDefault } from '../../component-stories/ladle-types';
import layout from '../../component-stories/story-layout.module.css';
import { AudioPlayer } from './AudioPlayer';

export default { title: 'Components / AudioPlayer' } satisfies StoryDefault;

// A tiny silent WAV so the player has real, loadable metadata in the gallery
// without depending on a backend media route.
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

const Frame = ({ label, seed }: { label: string; seed: string }) => (
  <div className={layout.row}>
    <span className={layout.label}>{label}</span>
    <div style={{ width: 220 }}>
      <AudioPlayer src={SILENT_WAV} seed={seed} />
    </div>
  </div>
);

// Different seeds produce different, stable waveform silhouettes.
export const Default: Story = () => (
  <div className={layout.inlineCluster}>
    <Frame label="Clip A" seed="clip-alpha" />
    <Frame label="Clip B" seed="clip-bravo" />
    <Frame label="Clip C" seed="clip-charlie" />
  </div>
);
