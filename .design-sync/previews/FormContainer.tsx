import { FormContainer, FormTitle } from 'makefx';
export const Default = () => (
  <FormContainer>
    <FormTitle>Create your space</FormTitle>
    <p style={{ color: 'var(--color-text-muted)' }}>
      A container that constrains form content to a readable width.
    </p>
  </FormContainer>
);
export const Narrow = () => (
  <FormContainer maxWidth={360}>
    <FormTitle>Create your space</FormTitle>
    <p style={{ color: 'var(--color-text-muted)' }}>Constrained to a narrow column.</p>
  </FormContainer>
);
