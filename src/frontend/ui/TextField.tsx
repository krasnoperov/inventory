import { forwardRef } from 'react';
import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react';
import styles from './TextField.module.css';

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  fullWidth?: boolean;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput({
  className,
  fullWidth = false,
  type = 'text',
  ...props
}, ref) {
  return (
    <input
      {...props}
      ref={ref}
      type={type}
      className={cx(styles.control, styles.input, fullWidth && styles.fullWidth, className)}
    />
  );
});

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  compact?: boolean;
  fullWidth?: boolean;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea({
  className,
  compact = false,
  fullWidth = false,
  ...props
}, ref) {
  return (
    <textarea
      {...props}
      ref={ref}
      className={cx(
        styles.control,
        styles.textarea,
        compact && styles.compactTextarea,
        fullWidth && styles.fullWidth,
        className,
      )}
    />
  );
});
