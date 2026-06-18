import type { Story, StoryDefault } from '../../component-stories/ladle-types';
import { ErrorMessage } from './ErrorMessage';

export default { title: 'Forms / ErrorMessage' } satisfies StoryDefault;

export const WithMessage: Story = () => (
  <ErrorMessage message="That email or password didn't match our records." />
);
