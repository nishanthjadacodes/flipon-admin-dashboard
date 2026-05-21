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

// True when the dashboard is running inside the customer app's
// React Native WebView (the Admin Dashboard tile on ModeSelect).
const isInWebView = (): boolean =>
  typeof window !== 'undefined' && !!(window as unknown as { ReactNativeWebView?: unknown }).ReactNativeWebView;

/**
 * Saves a text payload as a downloadable file.
 *
 * In a normal browser this does the standard Blob + `<a download>`
 * trick. Inside the customer app's Android WebView that trick
 * SILENTLY FAILS — Android WebView ignores `blob:` URLs and the
 * `download` attribute, so the Export button appeared dead. When we
 * detect the WebView we instead forward the content to the native
 * side via `postMessage`; WebViewScreen writes the file and opens
 * the OS share sheet so the user can save / send it.
 */
export function saveTextFile(
  filename: string,
  content: string,
  mime = 'text/csv;charset=utf-8',
): void {
  if (!content) return;
  const name = /\.[a-z0-9]+$/i.test(filename) ? filename : `${filename}.csv`;

  if (isInWebView()) {
    const bridge = (window as unknown as {
      ReactNativeWebView: { postMessage: (m: string) => void };
    }).ReactNativeWebView;
    bridge.postMessage(
      JSON.stringify({ type: 'DOWNLOAD_FILE', filename: name, content, mime }),
    );
    return;
  }

  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadCsv<T extends object>(
  filename: string,
  rows: T[],
  columns?: CsvColumn<T>[],
): void {
  const csv = toCsv(rows, columns);
  if (!csv) return;
  saveTextFile(filename, csv, 'text/csv;charset=utf-8');
}
