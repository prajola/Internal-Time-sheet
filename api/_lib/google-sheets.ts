/**
 * Minimal Google Sheets API client.
 *
 * Deliberately not the `googleapis` package: that pulls ~50MB of
 * generated clients into a serverless bundle for the four calls this
 * app makes. A service-account JWT is ~30 lines with node:crypto, and
 * the REST surface we need is three endpoints.
 *
 * Auth: a service account signs a JWT with its private key and
 * exchanges it for an access token (the OAuth2 "jwt-bearer" flow). No
 * user interaction, no refresh-token storage, nothing to re-consent —
 * which is what makes it the right fit for a server.
 *
 * Required env:
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL   something@project.iam.gserviceaccount.com
 *   GOOGLE_PRIVATE_KEY             the PEM from the service-account JSON key
 *   GOOGLE_SHEET_ID                the id from the spreadsheet URL
 *
 * The spreadsheet must be shared with GOOGLE_SERVICE_ACCOUNT_EMAIL as
 * an Editor — a service account is a separate identity and cannot see
 * your Drive otherwise.
 */
import { createSign } from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const API = "https://sheets.googleapis.com/v4/spreadsheets";

export function sheetId(): string {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw new Error("GOOGLE_SHEET_ID is not set");
  return id;
}

function serviceAccountEmail(): string {
  const e = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  if (!e) throw new Error("GOOGLE_SERVICE_ACCOUNT_EMAIL is not set");
  return e;
}

/**
 * The PEM, de-mangled.
 *
 * Env vars can't hold real newlines in most dashboards (Vercel
 * included), so the key is almost always pasted with literal "\n"
 * sequences. Some tools also wrap it in quotes. Both are handled here
 * rather than making every operator get it exactly right.
 */
function privateKey(): string {
  let k = process.env.GOOGLE_PRIVATE_KEY;
  if (!k) throw new Error("GOOGLE_PRIVATE_KEY is not set");
  k = k.trim();
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) {
    k = k.slice(1, -1);
  }
  k = k.replace(/\\n/g, "\n");
  if (!k.includes("BEGIN PRIVATE KEY")) {
    throw new Error("GOOGLE_PRIVATE_KEY does not look like a PEM private key");
  }
  return k;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/* ── Access token (cached per warm instance) ─────────────────── */

let cachedToken: { token: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  // Refresh a minute early so a token can't expire mid-request.
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) return cachedToken.token;

  const iat = Math.floor(Date.now() / 1000);
  const claims = {
    iss: serviceAccountEmail(),
    scope: SCOPE,
    aud: TOKEN_URL,
    iat,
    exp: iat + 3600,
  };
  const header = { alg: "RS256", typ: "JWT" };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;

  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const jwt = `${unsigned}.${b64url(signer.sign(privateKey()))}`;

  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`Google token exchange failed: HTTP ${r.status} ${body.slice(0, 300)}`);

  const data = JSON.parse(body) as { access_token: string; expires_in: number };
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.token;
}

/** Drop the cached token. For tests and long-lived scripts. */
export function resetAuth(): void {
  cachedToken = null;
}

/* ── Request plumbing ────────────────────────────────────────── */

/**
 * Sheets returns 429 (per-minute quota) and 5xx under load. Both are
 * safe to retry — unlike Airtable's monthly cap, a 429 here clears in
 * seconds. 403 is not retried: it almost always means the sheet was
 * never shared with the service account, and retrying hides that.
 */
async function call<T>(path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
  const delays = [400, 1200, 3000];
  const token = await accessToken();

  const r = await fetch(`${API}/${sheetId()}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (r.ok) return (await r.json()) as T;

  const body = await r.text();

  if ((r.status === 429 || r.status >= 500) && attempt < delays.length) {
    await new Promise((res) => setTimeout(res, delays[attempt]));
    return call<T>(path, init, attempt + 1);
  }

  if (r.status === 403) {
    throw new Error(
      `Google Sheets denied access (403). Share the spreadsheet with ` +
        `${serviceAccountEmail()} as an Editor.\n${body.slice(0, 300)}`,
    );
  }
  if (r.status === 404) {
    throw new Error(`Spreadsheet ${sheetId()} not found (404). Check GOOGLE_SHEET_ID.`);
  }
  throw new Error(`Google Sheets ${path}: HTTP ${r.status} ${body.slice(0, 300)}`);
}

/* ── The four operations this app needs ──────────────────────── */

export interface SheetMeta {
  title: string;
  sheetId: number;
  rowCount: number;
}

/** Tab names and ids. Used to detect a sheet that needs setting up. */
export async function listTabs(): Promise<SheetMeta[]> {
  const data = await call<{
    sheets?: Array<{ properties: { title: string; sheetId: number; gridProperties?: { rowCount?: number } } }>;
  }>("?fields=sheets.properties");
  return (data.sheets ?? []).map((s) => ({
    title: s.properties.title,
    sheetId: s.properties.sheetId,
    rowCount: s.properties.gridProperties?.rowCount ?? 0,
  }));
}

/** Read a whole tab. Returns raw rows, first row being the header. */
export async function readTab(title: string): Promise<string[][]> {
  const range = encodeURIComponent(`${title}`);
  const data = await call<{ values?: string[][] }>(
    `/values/${range}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`,
  );
  return data.values ?? [];
}

/**
 * Read several ranges in a single request.
 *
 * The hot path needs all seven entity tabs plus the journal and the
 * meta tab. As individual reads that is nine round-trips per request;
 * batchGet makes it one, which is the difference between a snappy page
 * and a visibly slow one.
 *
 * Returns results positionally, matching the ranges passed in.
 */
export async function batchRead(ranges: string[]): Promise<string[][][]> {
  if (ranges.length === 0) return [];
  const qs = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join("&");
  const data = await call<{ valueRanges?: Array<{ values?: string[][] }> }>(
    `/values:batchGet?${qs}&majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`,
  );
  const out = data.valueRanges ?? [];
  return ranges.map((_, i) => out[i]?.values ?? []);
}

/**
 * Append rows to the end of a tab.
 *
 * This is the only write the hot path uses, and it is why Sheets is a
 * safe backend: `append` resolves the insertion point server-side, so
 * two functions appending at the same moment get two rows rather than
 * one overwriting the other. There is no read-modify-write to lose.
 */
export async function appendRows(title: string, rows: Array<Array<string | number | boolean>>): Promise<void> {
  if (rows.length === 0) return;
  const range = encodeURIComponent(title);
  await call(
    `/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ values: rows }) },
  );
}

/** Overwrite a tab's contents starting at A1. Used only by compaction. */
export async function writeTab(title: string, rows: Array<Array<string | number | boolean>>): Promise<void> {
  const clearRange = encodeURIComponent(title);
  await call(`/values/${clearRange}:clear`, { method: "POST", body: "{}" });
  if (rows.length === 0) return;
  await call(`/values/${clearRange}?valueInputOption=RAW`, {
    method: "PUT",
    body: JSON.stringify({ values: rows }),
  });
}

/** Create tabs that don't exist yet. No-op for ones that do. */
export async function ensureTabs(titles: string[]): Promise<string[]> {
  const existing = new Set((await listTabs()).map((t) => t.title));
  const missing = titles.filter((t) => !existing.has(t));
  if (missing.length === 0) return [];

  await call("/:batchUpdate", {
    method: "POST",
    body: JSON.stringify({
      requests: missing.map((title) => ({ addSheet: { properties: { title } } })),
    }),
  });
  return missing;
}

/** Cheap reachability probe used by setup and health checks. */
export async function ping(): Promise<{ title: string; tabs: number }> {
  const data = await call<{ properties?: { title?: string }; sheets?: unknown[] }>(
    "?fields=properties.title,sheets.properties.title",
  );
  return { title: data.properties?.title ?? "(untitled)", tabs: (data.sheets ?? []).length };
}

/* ── Injectable transport ────────────────────────────────────── */

/**
 * The store talks to Google through this object rather than importing
 * the functions directly.
 *
 * That one indirection is what makes the storage logic testable without
 * a Google account: scripts/verify-sheets-store.ts swaps in an
 * in-memory spreadsheet and exercises journal replay, the compaction
 * watermark and concurrent appends for real. Those are the parts this
 * project invented and therefore the parts most likely to be wrong —
 * Google's own API is not what needs testing.
 */
export interface SheetsApi {
  batchRead: typeof batchRead;
  appendRows: typeof appendRows;
  writeTab: typeof writeTab;
  ensureTabs: typeof ensureTabs;
  listTabs: typeof listTabs;
  ping: typeof ping;
}

const realApi: SheetsApi = { batchRead, appendRows, writeTab, ensureTabs, listTabs, ping };
let impl: SheetsApi = realApi;

export function getSheetsApi(): SheetsApi {
  return impl;
}

/** Test seam. Pass nothing to restore the real client. */
export function setSheetsApi(next?: Partial<SheetsApi>): void {
  impl = next ? { ...realApi, ...next } : realApi;
}
