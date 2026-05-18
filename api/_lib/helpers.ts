/**
 * Common helpers: body parsing, JSON response, id generation, time math.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomBytes } from "node:crypto";

export function uuid(): string {
  // Node 18+: crypto.randomUUID — but randomBytes is universal here
  return randomBytes(16).toString("hex");
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function diffMinutes(startIso: string, endIso: string): number {
  return Math.max(0, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000));
}

/** Parse JSON body — handles already-parsed and raw text. */
export function readBody<T = unknown>(req: VercelRequest): T {
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body) as T;
    } catch {
      return {} as T;
    }
  }
  return (req.body ?? {}) as T;
}

export function ok(res: VercelResponse, data: unknown, status = 200): void {
  res.status(status).json(data);
}

export function badRequest(res: VercelResponse, msg: string): void {
  res.status(400).json({ error: msg });
}

export function notFound(res: VercelResponse, msg = "Not found"): void {
  res.status(404).json({ error: msg });
}

export function methodNotAllowed(res: VercelResponse): void {
  res.status(405).json({ error: "Method not allowed" });
}

export function emailLooksValid(s: unknown): s is string {
  if (typeof s !== "string") return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());
}

export function normalizeEmail(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Filter time-entries by (day | dateRange | month | year).
 * Use exactly one of the four filters; if none provided, returns input unchanged.
 */
export interface EntryFilter {
  day?: string;       // YYYY-MM-DD
  from?: string;      // YYYY-MM-DD
  to?: string;        // YYYY-MM-DD (inclusive)
  month?: string;     // YYYY-MM
  year?: string;      // YYYY
  userId?: string;
  taskId?: string;
}

export function applyEntryFilter<T extends { startedAt: string; userId: string; taskId: string | null }>(
  entries: T[],
  f: EntryFilter,
): T[] {
  return entries.filter((e) => {
    const date = e.startedAt.slice(0, 10);     // YYYY-MM-DD
    const month = e.startedAt.slice(0, 7);     // YYYY-MM
    const year = e.startedAt.slice(0, 4);      // YYYY

    if (f.day && date !== f.day) return false;
    if (f.from && date < f.from) return false;
    if (f.to && date > f.to) return false;
    if (f.month && month !== f.month) return false;
    if (f.year && year !== f.year) return false;
    if (f.userId && e.userId !== f.userId) return false;
    if (f.taskId && e.taskId !== f.taskId) return false;
    return true;
  });
}
