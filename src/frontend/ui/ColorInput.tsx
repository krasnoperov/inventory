import type { InputHTMLAttributes } from 'react';
import styles from './ColorInput.module.css';

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

export type ColorInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

export function ColorInput({ className, ...props }: ColorInputProps) {
  return (
    <input
      {...props}
      type="color"
      className={cx(styles.colorInput, className)}
    />
  );
}
