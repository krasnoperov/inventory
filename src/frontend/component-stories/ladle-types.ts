import type { ComponentType } from 'react';

// Local Ladle story types. We deliberately do NOT re-export from '@ladle/react':
// its v5 type entry pulls an internal .tsx (typings-for-build/app) that fails
// to type-check under React 19 + plain `tsc`. By hand-declaring the small
// surface the stories actually use, the stories stay in the app `tsc` graph
// (type-checked) without dragging Ladle's internals in. Mirrors usertold.

type StoryControl = {
  type: string;
  options?: readonly unknown[];
  labels?: Record<string, string>;
  min?: number;
  max?: number;
  step?: number;
};

type StoryArgType = {
  name?: string;
  description?: string;
  options?: readonly unknown[];
  control?: StoryControl;
};

export type Story<TProps = Record<string, never>> = ComponentType<TProps> & {
  args?: Partial<TProps>;
  argTypes?: Record<string, StoryArgType>;
  storyName?: string;
  meta?: Record<string, unknown>;
};

export type StoryDefault = {
  title?: string;
  meta?: Record<string, unknown>;
};
