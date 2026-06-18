import type { Story } from '@ladle/react';
import { HeaderNav } from './HeaderNav';

export default { title: 'Components / HeaderNav' };

export const WithName: Story = () => (
  <HeaderNav userName="Ada Lovelace" userEmail="ada@example.com" />
);

export const EmailOnly: Story = () => (
  <HeaderNav userName={null} userEmail="ada@example.com" />
);

export const WithoutDashboard: Story = () => (
  <HeaderNav userName="Ada Lovelace" showDashboard={false} />
);
