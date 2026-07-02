import type { HTMLAttributes, ReactNode } from 'react';
import styles from './DockedSheet.module.css';

interface DockedSheetProps extends Pick<HTMLAttributes<HTMLDivElement>, 'onClick'> {
  children: ReactNode;
  className?: string;
  panelClassName?: string;
  panelProps?: HTMLAttributes<HTMLDivElement>;
}

const cx = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' ');

export function DockedSheet({
  children,
  className,
  onClick,
  panelClassName,
  panelProps,
}: DockedSheetProps) {
  const { className: panelPropsClassName, ...restPanelProps } = panelProps ?? {};

  return (
    <div className={cx(styles.sheetHost, className)} onClick={onClick}>
      <div className={cx(styles.sheetPanel, panelClassName, panelPropsClassName)} {...restPanelProps}>
        {children}
      </div>
    </div>
  );
}

export default DockedSheet;
