import type { Story, StoryDefault } from '../../component-stories/ladle-types';
import { FormTitle } from './FormTitle';

export default { title: 'Forms / FormTitle' } satisfies StoryDefault;

export const Default: Story = () => <FormTitle>Sign in to your account</FormTitle>;
