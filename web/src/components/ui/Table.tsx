/**
 * Table — data surface primitive. Mascot-free (§8.4 hard rule).
 * Numeric/hash cells should use className="mono" for tabular-nums + IBM Plex Mono.
 */
import React from 'react';
import styles from './Table.module.css';

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  render: (row: T, idx: number) => React.ReactNode;
  /** hint for column type — 'mono' auto-applies tabular-nums styling */
  type?: 'text' | 'mono' | 'badge';
}

export interface TableProps<T> {
  columns: Column<T>[];
  rows: T[];
  /** unique key extractor */
  getKey: (row: T, idx: number) => string | number;
  className?: string;
  /** aria-label for the table */
  label?: string;
}

export function Table<T>({ columns, rows, getKey, className = '', label }: TableProps<T>) {
  return (
    <div className={[styles.tableWrap, className].filter(Boolean).join(' ')}>
      <table className={styles.table} aria-label={label}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} className={styles.th} scope="col">
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={getKey(row, idx)} className={styles.tr}>
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={[
                    styles.td,
                    col.type === 'mono' ? styles['td--mono'] : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {col.render(row, idx)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
