import type { Story, StoryDefault } from '../component-stories/ladle-types';
import layout from '../component-stories/story-layout.module.css';
import { Pagination } from './Pagination';

export default { title: 'Components / Pagination' } satisfies StoryDefault;

const noop = (_page: number) => {};

const Labeled = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className={layout.row}>
    <span className={layout.label}>{label}</span>
    {children}
  </div>
);

export const States: Story = () => (
  <div className={layout.stack}>
    <Labeled label="≤7 pages — all shown">
      <Pagination currentPage={2} totalPages={5} onPageChange={noop} />
    </Labeled>
    <Labeled label="Many — near start">
      <Pagination currentPage={2} totalPages={20} onPageChange={noop} />
    </Labeled>
    <Labeled label="Many — middle">
      <Pagination currentPage={10} totalPages={20} onPageChange={noop} />
    </Labeled>
    <Labeled label="Many — near end">
      <Pagination currentPage={19} totalPages={20} onPageChange={noop} />
    </Labeled>
  </div>
);

interface PaginationArgs {
  currentPage: number;
  totalPages: number;
}

export const Playground: Story<PaginationArgs> = ({ currentPage, totalPages }) => (
  <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={noop} />
);

Playground.args = { currentPage: 3, totalPages: 12 };
Playground.argTypes = {
  currentPage: { control: { type: 'range', min: 1, max: 20, step: 1 } },
  totalPages: { control: { type: 'range', min: 1, max: 20, step: 1 } },
};
