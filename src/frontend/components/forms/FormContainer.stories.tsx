import type { Story } from '@ladle/react';
import { FormContainer } from './FormContainer';
import { FormTitle } from './FormTitle';

export default { title: 'Forms / FormContainer' };

const SampleBody = () => (
  <>
    <FormTitle>Create your space</FormTitle>
    <p style={{ color: 'var(--color-text-muted)' }}>
      A container that constrains form content to a readable width.
    </p>
  </>
);

export const Default: Story = () => (
  <FormContainer>
    <SampleBody />
  </FormContainer>
);

export const Narrow: Story = () => (
  <FormContainer maxWidth={360}>
    <SampleBody />
  </FormContainer>
);
