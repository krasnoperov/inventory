import { ErrorMessage } from 'makefx';
const Dark = ({ children }: { children: React.ReactNode }) => (
  <div style={{ colorScheme: 'dark', background: 'var(--color-bg)', padding: '24px', borderRadius: '12px' }}>{children}</div>
);
export const WithMessage = () => <Dark><ErrorMessage message="That email or password didn't match our records." /></Dark>;
