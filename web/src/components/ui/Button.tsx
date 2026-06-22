/**
 * Button — design-system primitive.
 * Uses only tokens (no hex literals). Mascot-free (data surface safe).
 *
 * Variants:
 *   primary  — brass-fill bg + navy text (§8.1: brass is FILLS ONLY, never text-on-light)
 *   ghost    — transparent, paper-line border, ink text
 *   danger   — debit-tinted, used for destructive actions
 *   anchor   — aqua bg (reserved for on-chain/anchor semantics only, §8.1)
 */
import React from 'react';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'anchor';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: React.ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...rest
}: ButtonProps) {
  const cls = [
    styles.btn,
    styles[`btn--${variant}`],
    styles[`btn--${size}`],
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  );
}
