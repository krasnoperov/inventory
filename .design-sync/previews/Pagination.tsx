import { Pagination } from 'makefx';
const noop = () => {};
// Pagination's non-active buttons are white-glass (white text on translucent
// white) — designed to sit on the app's branded gradient surface, not a bare
// white card. Wrap each story in that surface so the ghost buttons are visible,
// matching how the app actually presents pagination.
const Surface = ({ children }: { children: React.ReactNode }) => (
  <div
    style={{
      background: 'linear-gradient(135deg, var(--brand-gradient-start), var(--brand-gradient-end))',
      padding: '24px',
      borderRadius: 'var(--radius-lg)',
      display: 'flex',
      justifyContent: 'center',
    }}
  >
    {children}
  </div>
);
export const FewPages = () => <Surface><Pagination currentPage={2} totalPages={5} onPageChange={noop} /></Surface>;
export const ManyMiddle = () => <Surface><Pagination currentPage={10} totalPages={20} onPageChange={noop} /></Surface>;
export const NearEnd = () => <Surface><Pagination currentPage={19} totalPages={20} onPageChange={noop} /></Surface>;
