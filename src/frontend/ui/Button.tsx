import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from '../components/Link';
import styles from './Button.module.css';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function buttonClassName({
  variant,
  size,
  iconOnly,
  className,
}: {
  variant: ButtonVariant;
  size: ButtonSize;
  iconOnly?: boolean;
  className?: string;
}) {
  return cx(
    styles.button,
    styles[variant],
    styles[size],
    iconOnly && styles.iconOnly,
    className,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconOnly?: boolean;
  children?: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  iconOnly = false,
  className,
  type = 'button',
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={buttonClassName({ variant, size, iconOnly, className })}
    >
      {children}
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonProps, 'iconOnly'> {
  'aria-label': string;
}

export function IconButton(props: IconButtonProps) {
  return <Button {...props} iconOnly />;
}

export interface ButtonLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: string;
  replace?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
  children?: ReactNode;
}

export function ButtonLink({
  to,
  replace,
  variant = 'secondary',
  size = 'md',
  className,
  children,
  ...props
}: ButtonLinkProps) {
  return (
    <Link
      {...props}
      to={to}
      replace={replace}
      className={buttonClassName({ variant, size, className })}
    >
      {children}
    </Link>
  );
}
