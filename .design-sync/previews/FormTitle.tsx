import { FormTitle } from 'makefx';
const Dark = ({ children }: { children: React.ReactNode }) => (
  <div style={{ colorScheme: 'dark', background: 'var(--color-bg)', padding: '24px', borderRadius: '12px' }}>{children}</div>
);
export const Default = () => <Dark><FormTitle>Sign in to your account</FormTitle></Dark>;
