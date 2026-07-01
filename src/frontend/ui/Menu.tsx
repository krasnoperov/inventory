import { Menu as BaseMenu } from '@base-ui/react/menu';
import type { ReactNode } from 'react';
import styles from './Menu.module.css';

export interface MenuItem {
  id: string;
  label: ReactNode;
  textValue?: string;
  icon?: ReactNode;
  disabled?: boolean;
  danger?: boolean;
  onSelect: () => void;
}

export interface UiMenuProps {
  label: string;
  title?: string;
  trigger: ReactNode;
  items: MenuItem[];
  className?: string;
  popupClassName?: string;
  align?: 'start' | 'center' | 'end';
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

export function UiMenu({
  label,
  title,
  trigger,
  items,
  className,
  popupClassName,
  align = 'end',
}: UiMenuProps) {
  return (
    <BaseMenu.Root modal={false}>
      <BaseMenu.Trigger className={cx(styles.trigger, className)} aria-label={label} title={title ?? label}>
        {trigger}
      </BaseMenu.Trigger>
      <BaseMenu.Portal>
        <BaseMenu.Positioner className={styles.positioner} sideOffset={4} align={align}>
          <BaseMenu.Popup className={cx(styles.popup, popupClassName)}>
            {items.map((item) => (
              <BaseMenu.Item
                key={item.id}
                className={cx(styles.item, item.danger && styles.danger)}
                disabled={item.disabled}
                label={item.textValue}
                onClick={item.onSelect}
              >
                {item.icon && <span className={styles.itemIcon}>{item.icon}</span>}
                <span className={styles.itemLabel}>{item.label}</span>
              </BaseMenu.Item>
            ))}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}
