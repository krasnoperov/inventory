import type { ReactNode } from 'react';
import { Button } from './Button';
import styles from './SegmentedControl.module.css';

export interface SegmentedControlOption<Value extends string = string> {
  value: Value;
  label: ReactNode;
  disabled?: boolean;
  title?: string;
  tone?: 'danger';
}

export interface SegmentedControlProps<Value extends string = string> {
  label: string;
  value?: Value | null;
  options: ReadonlyArray<SegmentedControlOption<Value>>;
  onValueChange: (value: Value) => void;
  className?: string;
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

export function SegmentedControl<Value extends string = string>({
  label,
  value,
  options,
  onValueChange,
  className,
}: SegmentedControlProps<Value>) {
  return (
    <div className={cx(styles.root, className)} role="radiogroup" aria-label={label}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Button
            key={option.value}
            className={cx(
              styles.option,
              selected && styles.selected,
              selected && option.tone === 'danger' && styles.selectedDanger,
            )}
            role="radio"
            aria-checked={selected}
            disabled={option.disabled}
            title={option.title}
            variant="ghost"
            size="sm"
            onClick={() => onValueChange(option.value)}
          >
            {option.label}
          </Button>
        );
      })}
    </div>
  );
}
