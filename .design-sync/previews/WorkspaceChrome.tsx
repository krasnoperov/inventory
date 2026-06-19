import { WorkspaceChrome } from 'makefx';
import type { ReactNode } from 'react';

// The workspace header as used on the space/production pages: dark bar with the
// space name, an OWNER role badge, member/asset counts, a Live pill, and the
// view-mode + action icon row. WorkspaceChrome is the shell; this fills its
// slots to match the real header (bare slots look empty).
const Dark = ({ children }: { children: ReactNode }) => (
  <div style={{ colorScheme: 'dark', background: 'oklch(12% 0.015 264)', padding: '16px' }}>{children}</div>
);

const Pill = ({ children, color, bg, border }: { children: ReactNode; color: string; bg: string; border?: string }) => (
  <span style={{ fontSize: 'var(--font-size-micro)', fontWeight: 700, letterSpacing: '0.04em', padding: '3px 9px', borderRadius: 'var(--radius-full)', color, background: bg, border: border ? `1px solid ${border}` : undefined }}>
    {children}
  </span>
);

const IconBtn = ({ children, active }: { children: ReactNode; active?: boolean }) => (
  <button style={{ width: '32px', height: '32px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: active ? 'var(--color-primary)' : 'transparent', color: 'var(--color-text)', display: 'inline-grid', placeItems: 'center', cursor: 'pointer', fontSize: '15px' }}>
    {children}
  </button>
);

const Left = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
    <strong style={{ fontSize: 'var(--font-size-h3)', color: 'var(--color-text)' }}>LearnSpeakRepeat Podcast</strong>
    <Pill color="var(--color-role-owner)" bg="var(--color-role-owner-bg)" border="var(--color-role-owner-border)">OWNER</Pill>
    <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-small)' }}>👥 1</span>
    <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-small)' }}>🖼 1</span>
    <Pill color="var(--color-success)" bg="var(--color-status-completed-bg)">● Live</Pill>
  </div>
);

const Right = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
    <IconBtn active>🌲</IconBtn>
    <IconBtn>🔮</IconBtn>
    <IconBtn>▦</IconBtn>
    <IconBtn>◎</IconBtn>
    <span style={{ width: '1px', height: '20px', background: 'var(--color-border)', margin: '0 4px' }} />
    <IconBtn>⬇</IconBtn>
    <IconBtn>⬆</IconBtn>
    <IconBtn>🎨</IconBtn>
  </div>
);

export const SpaceHeader = () => (
  <Dark>
    <WorkspaceChrome leftSlot={<Left />} rightSlot={<Right />} />
  </Dark>
);
