import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';

import styles from './Button.module.css';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
type ButtonSize = 'sm' | 'md' | 'lg';

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  children?: ReactNode;
}

interface ButtonAsButton extends CommonProps, Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'disabled'> {
  as?: 'button';
  href?: never;
  type?: 'button' | 'submit' | 'reset';
}

interface ButtonAsAnchor extends CommonProps, Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  as: 'a';
  href: string;
  type?: never;
}

export type ButtonProps = ButtonAsButton | ButtonAsAnchor;

export default function Button(props: ButtonProps) {
  const {
    variant = 'primary',
    size = 'md',
    loading = false,
    disabled = false,
    fullWidth = false,
    children,
    className,
  } = props;

  const classes = [
    styles.button,
    styles[variant],
    styles[size],
    fullWidth ? styles.fullWidth : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const isDisabled = disabled || loading;
  const spinner = loading ? <span className={styles.spinner} aria-hidden="true" /> : null;

  if (props.as === 'a') {
    const { href, ...anchorProps } = props;
    const {
      variant: _variant,
      size: _size,
      loading: _loading,
      disabled: _disabled,
      fullWidth: _fullWidth,
      children: _children,
      className: _className,
      as: _as,
      ...anchorRest
    } = anchorProps;

    return (
      <a
        href={href}
        className={classes}
        aria-disabled={isDisabled || undefined}
        {...anchorRest}
      >
        {spinner}
        {children}
      </a>
    );
  }

  const { type = 'button', ...buttonProps } = props;
  const {
    variant: _variant2,
    size: _size2,
    loading: _loading2,
    disabled: _disabled2,
    fullWidth: _fullWidth2,
    children: _children2,
    className: _className2,
    as: _as2,
    href: _href2,
    ...buttonRest
  } = buttonProps;

  return (
    <button type={type} className={classes} disabled={isDisabled} {...buttonRest}>
      {spinner}
      {children}
    </button>
  );
}
