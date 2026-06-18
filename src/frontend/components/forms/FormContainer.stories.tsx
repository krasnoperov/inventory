import type { Story, StoryDefault } from '../../component-stories/ladle-types';
import layout from '../../component-stories/story-layout.module.css';
import { FormContainer } from './FormContainer';
import { FormTitle } from './FormTitle';

export default { title: 'Forms / FormContainer' } satisfies StoryDefault;

const SampleBody = () => (
  <>
    <FormTitle>Create your space</FormTitle>
    <p className={layout.muted}>
      A container that constrains form content to a readable width.
    </p>
  </>
);

export const Widths: Story = () => (
  <div className={layout.stack}>
    <div className={layout.row}>
      <span className={layout.label}>Default (max 720)</span>
      <FormContainer>
        <SampleBody />
      </FormContainer>
    </div>
    <div className={layout.row}>
      <span className={layout.label}>Narrow (max 360)</span>
      <FormContainer maxWidth={360}>
        <SampleBody />
      </FormContainer>
    </div>
  </div>
);

interface FormContainerArgs {
  maxWidth: number;
}

export const Playground: Story<FormContainerArgs> = ({ maxWidth }) => (
  <FormContainer maxWidth={maxWidth}>
    <SampleBody />
  </FormContainer>
);

Playground.args = { maxWidth: 560 };
Playground.argTypes = {
  maxWidth: { control: { type: 'range', min: 280, max: 960, step: 20 } },
};
