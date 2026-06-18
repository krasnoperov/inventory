import { AppHeader, HeaderNav } from 'makefx';
const Brand = () => <strong style={{ fontSize: 'var(--font-size-h3)' }}>Make Effects</strong>;
export const Full = () => (
  <AppHeader
    leftSlot={<Brand />}
    centerSlot={<span style={{ color: 'var(--color-text-muted)' }}>My Space</span>}
    rightSlot={<HeaderNav userName="Ada Lovelace" userEmail="ada@example.com" />}
  />
);
export const Loading = () => (
  <AppHeader leftSlot={<Brand />} rightSlot={<HeaderNav userName="Ada" />} isLoading />
);
