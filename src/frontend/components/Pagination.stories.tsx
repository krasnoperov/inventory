import type { Story } from '@ladle/react';
import { Pagination } from './Pagination';

export default { title: 'Components / Pagination' };

const noop = (_page: number) => {};

export const FewPages: Story = () => (
  <Pagination currentPage={2} totalPages={5} onPageChange={noop} />
);

export const ManyPagesNearStart: Story = () => (
  <Pagination currentPage={2} totalPages={20} onPageChange={noop} />
);

export const ManyPagesMiddle: Story = () => (
  <Pagination currentPage={10} totalPages={20} onPageChange={noop} />
);

export const ManyPagesNearEnd: Story = () => (
  <Pagination currentPage={19} totalPages={20} onPageChange={noop} />
);
