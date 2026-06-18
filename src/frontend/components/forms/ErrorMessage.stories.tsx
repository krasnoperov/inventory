import type { Story } from '@ladle/react';
import { ErrorMessage } from './ErrorMessage';

export default { title: 'Forms / ErrorMessage' };

export const WithMessage: Story = () => (
  <ErrorMessage message="That email or password didn't match our records." />
);
