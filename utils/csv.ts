// Tiny CSV serializer used by the admin panel's Global Exports feature.
// Super Admin pulls operational, user and agent data down as .csv.

export interface CsvColumn<T = Record<string, unknown>> { // T is intentionally loose
  key: string;
  label?: string;
  value?: (row: T) => unknown;
}

const escape = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv<T extends object>(
  rows: T[],
  columns?: CsvColumn<T>[],
): string {
  if (!rows || rows.length === 0) return '';
  // If columns aren't supplied, derive from the first row's keys.
  const cols: CsvColumn<T>[] =
    columns && columns.length > 0
      ? columns
      : Object.keys(rows[0]).map((k) => ({ key: k, label: k }));
  const header = cols.map((c) => escape(c.label || c.key)).join(',');
  const body = rows
    .map((r) =>
      cols
        .map((c) => escape(typeof c.value === 'function' ? c.value(r) : (r as any)[c.key]))
        .join(','),
    )
    .join('\n');
  return `${header}\n${body}`;
}

export function downloadCsv<T extends object>(
  filename: string,
  rows: T[],
  columns?: CsvColumn<T>[],
): void {
  const csv = toCsv(rows, columns);
  if (!csv) return;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
