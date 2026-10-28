// CSV export of a report table, built in the browser from data the page already shows (no new
// server data is exposed). A UTF-8 byte-order mark keeps Arabic text readable in spreadsheet apps;
// cells that could be read as formulas are prefixed so a spreadsheet never evaluates them.

export type CsvCell = string | number | null | undefined;

export function toCsv(rows: CsvCell[][]): string {
  const cell = (v: CsvCell) => {
    if (v === null || v === undefined) return '';
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s) && typeof v !== 'number') s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n');
}

/** Minor units → plain decimal text for spreadsheets (exact, no currency symbol). */
export const csvMoney = (minor: number) =>
  `${minor < 0 ? '-' : ''}${Math.trunc(Math.abs(minor) / 100)}.${String(Math.abs(minor) % 100).padStart(2, '0')}`;

export function downloadCsv(filename: string, rows: CsvCell[][]) {
  const blob = new Blob([String.fromCharCode(0xfeff), toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
