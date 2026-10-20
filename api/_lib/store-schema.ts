/**
 * The storage schema, shared by every backend.
 *
 * One worksheet/tab per entity, one row per record, columns declared
 * here. Both storage drivers — the Excel workbook in Vercel Blob
 * (xlsx-store.ts) and Google Sheets (sheets-store.ts) — read these same
 * definitions, so a column added here appears in both and the two can
 * never drift into storing different shapes.
 *
 * The record shapes themselves live in ./types.ts; this file is only
 * about how they sit in a spreadsheet.
 */

/**
 * How a column round-trips through a spreadsheet cell.
 *
 * A spreadsheet has no concept of "null vs empty string", so each
 * column declares what a blank cell decodes back to. These mirror the
 * shapes the API and frontend already expect — see ./types.ts.
 */
export type Kind = "str" | "strOrNull" | "strOrUndef" | "bool" | "num";

export type EntityName =
  | "users"
  | "tasks"
  | "timeEntries"
  | "invitations"
  | "notifications"
  | "queries"
  | "holidays";

export interface EntitySpec {
  sheet: string;
  columns: Array<[string, Kind]>;
}

export const SCHEMA: Record<EntityName, EntitySpec> = {
  users: {
    sheet: "Users",
    columns: [
      ["id", "str"],
      ["email", "str"],
      ["name", "str"],
      ["role", "str"],
      ["active", "bool"],
      ["createdAt", "str"],
      ["invitedBy", "strOrUndef"],
      ["passwordHash", "strOrNull"],
      ["passwordSetAt", "strOrNull"],
      ["sessionsRevokedAt", "strOrNull"],
    ],
  },
  tasks: {
    sheet: "Tasks",
    columns: [
      ["id", "str"],
      ["title", "str"],
      ["description", "str"],
      ["assigneeId", "strOrNull"],
      ["status", "str"],
      ["priority", "str"],
      ["dueDate", "strOrNull"],
      ["createdAt", "str"],
      ["updatedAt", "str"],
      ["createdBy", "str"],
    ],
  },
  timeEntries: {
    sheet: "TimeEntries",
    columns: [
      ["id", "str"],
      ["userId", "str"],
      ["taskId", "strOrNull"],
      ["description", "str"],
      ["startedAt", "str"],
      ["endedAt", "strOrNull"],
      ["durationMinutes", "num"],
      ["createdAt", "str"],
      ["updatedAt", "str"],
      // Admin acknowledgement of clock-in/clock-out. The Airtable layer
      // dropped these on the floor — written by api/time-entries/[id].ts,
      // read by AdminTimesheets.tsx, but never persisted.
      ["clockInAckedAt", "strOrNull"],
      ["clockInAckedBy", "strOrNull"],
      ["clockInAckedByName", "strOrNull"],
      ["clockOutAckedAt", "strOrNull"],
      ["clockOutAckedBy", "strOrNull"],
      ["clockOutAckedByName", "strOrNull"],
    ],
  },
  invitations: {
    sheet: "Invitations",
    columns: [
      ["id", "str"],
      ["email", "str"],
      ["role", "str"],
      ["invitedBy", "str"],
      ["createdAt", "str"],
      ["expiresAt", "str"],
      ["acceptedAt", "strOrUndef"],
    ],
  },
  notifications: {
    sheet: "Notifications",
    columns: [
      ["id", "str"],
      ["userId", "str"],
      ["kind", "str"],
      ["title", "str"],
      ["body", "str"],
      ["link", "strOrNull"],
      ["taskId", "strOrNull"],
      ["fromUserId", "strOrNull"],
      ["fromUserName", "strOrNull"],
      ["readAt", "strOrNull"],
      ["createdAt", "str"],
    ],
  },
  queries: {
    sheet: "Queries",
    columns: [
      ["id", "str"],
      ["userId", "str"],
      ["userName", "str"],
      ["userEmail", "str"],
      ["category", "str"],
      ["subject", "str"],
      ["body", "str"],
      ["status", "str"],
      ["taskId", "strOrNull"],
      ["createdAt", "str"],
      ["updatedAt", "str"],
      ["adminResponse", "str"],
      ["respondedAt", "strOrNull"],
      ["respondedBy", "strOrNull"],
      ["respondedByName", "strOrNull"],
    ],
  },
  holidays: {
    sheet: "Holidays",
    columns: [
      ["id", "str"],
      ["userId", "str"],
      ["userName", "str"],
      ["userEmail", "str"],
      ["startDate", "str"],
      ["endDate", "str"],
      ["halfDay", "bool"],
      ["kind", "str"],
      ["reason", "str"],
      ["status", "str"],
      ["days", "num"],
      ["createdAt", "str"],
      ["updatedAt", "str"],
      ["decidedAt", "strOrNull"],
      ["decidedBy", "strOrNull"],
      ["decidedByName", "strOrNull"],
      ["decisionNote", "str"],
    ],
  },
};

export const ENTITIES = Object.keys(SCHEMA) as EntityName[];

/* ── Mutations ───────────────────────────────────────────────── */

export type Op =
  | { op: "put"; entity: EntityName; id: string; rec: Record<string, unknown> }
  | { op: "del"; entity: EntityName; id: string };

/** The whole dataset in memory: one id-keyed map per entity. */
export type State = Record<EntityName, Map<string, any>>;

export function emptyState(): State {
  const s = {} as State;
  for (const e of ENTITIES) s[e] = new Map();
  return s;
}

export function cloneState(src: State): State {
  const s = {} as State;
  for (const e of ENTITIES) s[e] = new Map(src[e]);
  return s;
}

export function applyOps(state: State, ops: Op[]): void {
  for (const op of ops) {
    const bucket = state[op.entity];
    if (!bucket) continue; // Unknown entity from a newer build — ignore.
    if (op.op === "put") bucket.set(op.id, op.rec);
    else bucket.delete(op.id);
  }
}

/* ── Value coercion ──────────────────────────────────────────── */

/**
 * Coerce a record to its declared column shape before it is stored.
 *
 * This is what keeps a value identical across a storage round-trip, and
 * it drops any stray keys a caller spread in. The null/undefined/""
 * rules mirror what the API and frontend expect for each field.
 *
 * Shared by both drivers and by the migration scripts so none of them
 * can drift apart.
 */
export function normalizeRecord(entity: EntityName, rec: Record<string, any>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, kind] of SCHEMA[entity].columns) {
    const v = rec[name];
    switch (kind) {
      case "bool":
        out[name] = v === true;
        break;
      case "num":
        out[name] = typeof v === "number" && Number.isFinite(v) ? v : 0;
        break;
      case "strOrNull":
        out[name] = v === null || v === undefined || v === "" ? null : String(v);
        break;
      case "strOrUndef":
        if (!(v === null || v === undefined || v === "")) out[name] = String(v);
        break;
      default:
        out[name] = v === null || v === undefined ? "" : String(v);
    }
  }
  return out;
}

/**
 * Decode one cell value coming back from a spreadsheet.
 *
 * Handles the richer shapes ExcelJS returns ({text}, {result}, Date)
 * and the plain strings the Sheets API returns, so both drivers can
 * share one decoder.
 */
export function decodeCell(raw: unknown, kind: Kind): unknown {
  let v: unknown = raw;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (v instanceof Date) v = (v as Date).toISOString();
    else if ("text" in o) v = o.text;
    else if ("result" in o) v = o.result;
  }
  if (kind === "bool") return v === true || v === "TRUE" || v === "true" || v === 1 || v === "1";
  if (kind === "num") {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  const s = v === null || v === undefined ? "" : String(v);
  if (s === "") return kind === "strOrNull" ? null : kind === "strOrUndef" ? undefined : "";
  return s;
}
