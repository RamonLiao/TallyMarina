/**
 * Badge — semantic-color mapping for routing status (visual contract for routing UI).
 *
 * Status → semantic color mapping (LOAD-BEARING — asserted in tests):
 *   AUTO         → --credit  (green: AI routed with high confidence)
 *   NEEDS_REVIEW → --warn    (amber: needs human review)
 *   ANCHORED     → --aqua    (on-chain confirmed; §8.1 aqua = blockchain semantics)
 *   REJECTED     → --debit   (red: rejected / error)
 *   DRAFT        → --ink-soft (neutral)
 *
 * Mascot-free — data surface safe.
 */
import React from 'react';
import styles from './Badge.module.css';

export type BadgeStatus = 'AUTO' | 'NEEDS_REVIEW' | 'ANCHORED' | 'REJECTED' | 'DRAFT';

export interface BadgeProps {
  status: BadgeStatus;
  label?: string;
  className?: string;
}

const STATUS_LABEL: Record<BadgeStatus, string> = {
  AUTO:         'Auto',
  NEEDS_REVIEW: 'Needs Review',
  ANCHORED:     'Anchored',
  REJECTED:     'Rejected',
  DRAFT:        'Draft',
};

export function Badge({ status, label, className = '' }: BadgeProps) {
  const cls = [
    styles.badge,
    styles[`badge--${status.toLowerCase().replace(/_/g, '-')}`],
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={cls} data-status={status}>
      {label ?? STATUS_LABEL[status]}
    </span>
  );
}
