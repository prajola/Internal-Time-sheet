/**
 * CSV download helpers. Pure client-side: build a string, wrap in a
 * Blob, trigger a download via an anchor element. The UTF-8 BOM keeps
 * accented characters readable when the file is opened directly in
 * Excel for Windows (which otherwise defaults to a legacy code page).
 *
 * Deferred cleanup matches Safari's expected lifecycle — revoking the
 * blob URL immediately can cancel an in-flight download.
 */

export function escapeCsvField(s: unknown): string {
  if (s == null) return "";
  const v = String(s);
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function rowsToCsv(rows: Array<Array<unknown>>): string {
  return rows.map((row) => row.map(escapeCsvField).join(",")).join("\n");
}

export function downloadCsv(filename: string, rows: Array<Array<unknown>>): void {
  const csv = rowsToCsv(rows);
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
}

/** Build a date-suffixed filename like `kubegraf-users-2026-05-19.csv`. */
export function dateStampedName(prefix: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${prefix}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.csv`;
}
