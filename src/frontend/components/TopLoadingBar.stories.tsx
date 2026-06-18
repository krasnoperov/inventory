import type { Story, StoryDefault } from '../component-stories/ladle-types';
import { TopLoadingBar } from './TopLoadingBar';

export default { title: 'Components / TopLoadingBar' } satisfies StoryDefault;

// The bar is position: fixed at the top of the viewport; the spacer keeps the
// story frame tall enough to see it.
export const Loading: Story = () => (
  <div style={{ position: 'relative', minHeight: '120px' }}>
    <TopLoadingBar isLoading />
  </div>
);
