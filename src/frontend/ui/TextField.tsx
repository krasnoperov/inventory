import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react';
import styles from './TextField.module.css';

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  fullWidth?: boolean;
}

export function TextInput({
  className,
  fullWidth = false,
  type = 'text',
  ...props
}: TextInputProps) {
  return (
    <input
      {...props}
      type={type}
      className={cx(styles.control, styles.input, fullWidth && styles.fullWidth, className)}
    />
  );
}

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  compact?: boolean;
  fullWidth?: boolean;
}

export function TextArea({
  className,
  compact = false,
  fullWidth = false,
  ...props
}: TextAreaProps) {
  return (
    <textarea
      {...props}
      className={cx(
        styles.control,
        styles.textarea,
        compact && styles.compactTextarea,
        fullWidth && styles.fullWidth,
        className,
      )}
    />
  );
}
