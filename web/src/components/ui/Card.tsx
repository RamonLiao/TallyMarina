/**
 * Card — data-surface safe (mascot-free). Lifts off paper bg via --paper-card
 * + navy-tinted shadow. 1px --paper-line border. Radius --radius-md (12px).
 */
import React from 'react';
import styles from './Card.module.css';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  /** 'default' lifts off paper bg; 'austere' is navy-dark for hash-chain/wallet */
  surface?: 'default' | 'austere';
}

export function Card({ surface = 'default', className = '', children, ...rest }: CardProps) {
  const cls = [
    styles.card,
    surface === 'austere' ? styles['card--austere'] : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cls} {...rest}>
      {children}
    </div>
  );
}
