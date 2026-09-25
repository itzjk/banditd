// A cell a spreadsheet would read as a formula (=, +, -, @, or a leading tab
// or carriage return) is prefixed with a quote so it opens as plain text.
const FORMULA_LEAD = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const raw = String(value).replace(/\r?\n/g, " ").trim();
  const text = typeof value === "string" && FORMULA_LEAD.test(raw) ? `'${raw}` : raw;
  return /[",;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvRows(header: string[], body: unknown[][]): string {
  return [header, ...body].map((line) => line.map(csvCell).join(",")).join("\r\n");
}
