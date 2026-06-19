import { HeaderNav } from 'makefx';
const Dark = ({ children }: { children: React.ReactNode }) => (
  <div style={{ colorScheme: 'dark', background: 'var(--color-bg)', padding: '16px 24px', borderRadius: '12px' }}>{children}</div>
);
export const WithName = () => <Dark><HeaderNav userName="Ada Lovelace" userEmail="ada@example.com" /></Dark>;
export const EmailOnly = () => <Dark><HeaderNav userName={null} userEmail="ada@example.com" /></Dark>;
