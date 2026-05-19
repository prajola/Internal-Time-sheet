#!/usr/bin/env node
/**
 * One-off setup: create the 5 tables used by the API in the configured
 * Airtable base. Idempotent — skips tables that already exist.
 *
 *   node --env-file=.env.local scripts/setup-airtable.mjs
 *
 * Required env: AIRTABLE_TOKEN, AIRTABLE_BASE_ID
 *
 * Field type choices:
 *   - IDs & ISO timestamps & enum-like fields → singleLineText (plain
 *     string — simpler, avoids Airtable's date type UTC quirks).
 *   - Free text / descriptions → multilineText.
 *   - Booleans → checkbox.
 *   - Numbers → number.
 *
 * Storing enums as text instead of singleSelect means the app owns the
 * vocabulary; no one can break it by changing dropdown options in Airtable.
 */
const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID } = process.env;
if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
  console.error("AIRTABLE_TOKEN and AIRTABLE_BASE_ID must be set. Run with --env-file=.env.local");
  process.exit(2);
}

const API = `https://api.airtable.com/v0/meta/bases/${AIRTABLE_BASE_ID}`;
const auth = { Authorization: `Bearer ${AIRTABLE_TOKEN}` };

const TEXT = { type: "singleLineText" };
const LONGTEXT = { type: "multilineText" };
const BOOL = { type: "checkbox", options: { color: "greenBright", icon: "check" } };
const NUM = { type: "number", options: { precision: 0 } };

const SCHEMA = [
  {
    name: "Users",
    fields: [
      { name: "id", ...TEXT },          // primary
      { name: "email", ...TEXT },
      { name: "name", ...TEXT },
      { name: "role", ...TEXT },        // "ADMIN" | "EMPLOYEE"
      { name: "active", ...BOOL },
      { name: "createdAt", ...TEXT },
      { name: "passwordHash", ...TEXT },
      { name: "passwordSetAt", ...TEXT },
      { name: "sessionsRevokedAt", ...TEXT },
      { name: "invitedBy", ...TEXT },
    ],
  },
  {
    name: "Tasks",
    fields: [
      { name: "id", ...TEXT },          // primary
      { name: "title", ...TEXT },
      { name: "description", ...LONGTEXT },
      { name: "assigneeId", ...TEXT },
      { name: "status", ...TEXT },      // "TODO" | "IN_PROGRESS" | "DONE" | "BLOCKED"
      { name: "priority", ...TEXT },    // "LOW" | "MEDIUM" | "HIGH"
      { name: "dueDate", ...TEXT },
      { name: "createdAt", ...TEXT },
      { name: "updatedAt", ...TEXT },
      { name: "createdBy", ...TEXT },
    ],
  },
  {
    name: "TimeEntries",
    fields: [
      { name: "id", ...TEXT },          // primary
      { name: "userId", ...TEXT },
      { name: "taskId", ...TEXT },
      { name: "description", ...LONGTEXT },
      { name: "startedAt", ...TEXT },
      { name: "endedAt", ...TEXT },
      { name: "durationMinutes", ...NUM },
      { name: "createdAt", ...TEXT },
      { name: "updatedAt", ...TEXT },
    ],
  },
  {
    name: "Invitations",
    fields: [
      { name: "id", ...TEXT },          // primary
      { name: "email", ...TEXT },
      { name: "role", ...TEXT },
      { name: "invitedBy", ...TEXT },
      { name: "createdAt", ...TEXT },
      { name: "expiresAt", ...TEXT },
      { name: "acceptedAt", ...TEXT },
    ],
  },
  {
    name: "Queries",
    fields: [
      { name: "id", ...TEXT },          // primary
      { name: "userId", ...TEXT },
      { name: "userName", ...TEXT },
      { name: "userEmail", ...TEXT },
      { name: "category", ...TEXT },    // "PORTAL" | "TECHNICAL" | "TASK" | "OTHER"
      { name: "subject", ...TEXT },
      { name: "body", ...LONGTEXT },
      { name: "status", ...TEXT },      // "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED"
      { name: "taskId", ...TEXT },
      { name: "createdAt", ...TEXT },
      { name: "updatedAt", ...TEXT },
      { name: "adminResponse", ...LONGTEXT },
      { name: "respondedAt", ...TEXT },
      { name: "respondedBy", ...TEXT },
      { name: "respondedByName", ...TEXT },
    ],
  },
  {
    name: "Notifications",
    fields: [
      { name: "id", ...TEXT },          // primary
      { name: "userId", ...TEXT },      // recipient
      { name: "kind", ...TEXT },
      { name: "title", ...TEXT },
      { name: "body", ...LONGTEXT },
      { name: "link", ...TEXT },
      { name: "taskId", ...TEXT },
      { name: "fromUserId", ...TEXT },
      { name: "fromUserName", ...TEXT },
      { name: "readAt", ...TEXT },
      { name: "createdAt", ...TEXT },
    ],
  },
];

async function listExistingTables() {
  const r = await fetch(`${API}/tables`, { headers: auth });
  if (!r.ok) {
    console.error(`Could not list tables: HTTP ${r.status} ${await r.text()}`);
    process.exit(1);
  }
  return (await r.json()).tables ?? [];
}

async function createTable(spec) {
  const r = await fetch(`${API}/tables`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify(spec),
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`HTTP ${r.status}: ${body}`);
  }
  return r.json();
}

const existing = await listExistingTables();
console.log(`Base has ${existing.length} table(s) already: ${existing.map((t) => t.name).join(", ") || "(none)"}`);

for (const spec of SCHEMA) {
  if (existing.find((t) => t.name === spec.name)) {
    console.log(`  skip  ${spec.name} — already exists`);
    continue;
  }
  try {
    const created = await createTable(spec);
    console.log(`  ok    ${spec.name} — created (${created.id})`);
  } catch (e) {
    console.error(`  FAIL  ${spec.name}: ${e.message}`);
    process.exit(1);
  }
}

console.log("\nDone. The base is ready for the app to use.");
