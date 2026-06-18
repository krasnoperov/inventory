import { WorkspaceChrome, HeaderNav } from 'makefx';
const Brand = () => <strong style={{ fontSize: 'var(--font-size-h3)' }}>Make Effects</strong>;
export const Full = () => (
  <WorkspaceChrome
    leftSlot={<Brand />}
    centerSlot={<span style={{ color: 'var(--color-text-muted)' }}>Production</span>}
    rightSlot={<HeaderNav userName="Ada Lovelace" userEmail="ada@example.com" />}
    statusSlot={<span style={{ color: 'var(--color-success)', fontSize: 'var(--font-size-small)' }}>● Synced</span>}
  />
);
