import { Select as BaseSelect } from '@base-ui/react/select';
import type { ReactNode } from 'react';
import styles from './Select.module.css';

export interface SelectOption<Value extends string = string> {
  value: Value;
  label: ReactNode;
  disabled?: boolean;
  textValue?: string;
}

export interface UiSelectProps<Value extends string = string> {
  value: Value;
  options: Array<SelectOption<Value>>;
  onValueChange: (value: Value) => void;
  disabled?: boolean;
  label: string;
  title?: string;
  className?: string;
  fullWidth?: boolean;
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

export function UiSelect<Value extends string = string>({
  value,
  options,
  onValueChange,
  disabled = false,
  label,
  title,
  className,
  fullWidth = false,
}: UiSelectProps<Value>) {
  return (
    <BaseSelect.Root
      value={value}
      onValueChange={(nextValue) => {
        if (nextValue !== null) onValueChange(nextValue as Value);
      }}
      disabled={disabled}
      items={options.map((option) => ({ value: option.value, label: option.label }))}
      modal={false}
    >
      <div className={cx(styles.select, fullWidth && styles.fullWidth, className)}>
        <BaseSelect.Trigger className={styles.trigger} aria-label={label} title={title ?? label}>
          <BaseSelect.Value className={styles.value} />
          <BaseSelect.Icon className={styles.icon} aria-hidden="true">
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M4 6l4 4 4-4" />
            </svg>
          </BaseSelect.Icon>
        </BaseSelect.Trigger>
      </div>
      <BaseSelect.Portal>
        <BaseSelect.Positioner
          className={styles.positioner}
          sideOffset={4}
          alignItemWithTrigger={false}
        >
          <BaseSelect.Popup className={styles.popup}>
            <BaseSelect.List>
              {options.map((option) => (
                <BaseSelect.Item
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  label={option.textValue}
                  className={styles.item}
                >
                  <BaseSelect.ItemText className={styles.itemText}>
                    {option.label}
                  </BaseSelect.ItemText>
                  <BaseSelect.ItemIndicator className={styles.itemIndicator}>
                    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
                    </svg>
                  </BaseSelect.ItemIndicator>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
