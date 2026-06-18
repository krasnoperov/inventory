import type { Story } from '@ladle/react';
import { TopLoadingBar } from './TopLoadingBar';

export default { title: 'Components / TopLoadingBar' };

// The bar is position: fixed at the top of the viewport; the spacer keeps the
// story frame tall enough to see it.
export const Loading: Story = () => (
  <div style={{ position: 'relative', minHeight: '120px' }}>
    <TopLoadingBar isLoading />
  </div>
);
