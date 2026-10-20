# Production deployment checklist

This app stores its data in an Excel workbook held in Vercel Blob. Once
the env vars below are set in Vercel and you push to your main branch,
the deployed site is the production app — `prajol@kubegraf.io` signs in
as the bootstrap admin, employees sign up themselves with `@kubegraf.io`
addresses.

## 1. Set environment variables in Vercel

Go to **vercel.com → your project → Settings → Environment Variables**.
Add the following, scoped to **Production** (tick **Preview** too if
you want preview deploys to share the same workbook — but see
`XLSX_STORE_PREFIX` below if you'd rather they didn't):

| Name | Value | Notes |
|---|---|---|
| `STORAGE_DRIVER` | `sheets` | `sheets` = Google Sheets (default). `xlsx` = the Excel-in-Vercel-Blob fallback. Switching backends is this one variable — no code change, no redeploy of new code. |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | `something@project.iam.gserviceaccount.com` | The `client_email` from the service-account JSON key. |
| `GOOGLE_PRIVATE_KEY` | `-----BEGIN PRIVATE KEY-----\n…` | The `private_key` from the same JSON. Paste it with the literal `\n` sequences intact — the client un-escapes them. Treat like a password. |
| `GOOGLE_SHEET_ID` | the id from the sheet URL | `docs.google.com/spreadsheets/d/`**`THIS PART`**`/edit` |

Only needed if you run the `xlsx` fallback driver:

| Name | Value | Notes |
|---|---|---|
| `BLOB_READ_WRITE_TOKEN` | `vercel_blob_rw_...` | Created automatically when you attach a Blob store (**Storage → Blob → Connect**). |
| `XLSX_STORE_PREFIX` | `db` (default) | Root folder inside the blob store. Set it to something else on Preview to give preview deploys their own data. |
| `JWT_SECRET` | Run `openssl rand -base64 48` and paste the output. | Suggested starter value (regenerate before going live):<br/>`tHdRs0AOcQORlWnobChClhiyL9jVcqA3gt_salbh4n7j2LTsggzr09yEG76vJC9i`<br/>Changing this signs every user out. |
| `BOOTSTRAP_ADMIN_EMAIL` | `prajol@kubegraf.io` | Whoever owns this email becomes ADMIN on first signup. After the workspace has any user, this var is ignored. |
| `APP_URL` | `https://kubegraf.io/timesheet` | Used in password-reset / invite emails so the links point at the right place. No trailing slash. Must include the `/timesheet` path. |

### Optional (only if you want emails to work)

| Name | Value | Notes |
|---|---|---|
| `GMAIL_USER` | `youraccount@gmail.com` | The Gmail account that sends invites and password-reset links. |
| `GMAIL_APP_PASSWORD` | 16-char Google App Password | Generate at https://myaccount.google.com/apppasswords — **not** your normal Gmail password. Without these, password-reset emails are silently skipped (the in-app sign-up flow still works). |
| `ADMIN_NOTIFY_EMAIL` | `prajol@kubegraf.io` | Address that gets admin-event email notifications (signups, clock-ins, etc.). Defaults to the first admin's email. |
| `ALLOWED_EMAIL_DOMAINS` | `kubegraf.io,partner.com` | Comma-separated extra domains beyond `kubegraf.io`. Empty by default. |

## 2. Deploy

```sh
git push origin main
```

Vercel auto-deploys on push. Or trigger manually from the Vercel
dashboard → Deployments → Redeploy.

## 2a. Route kubegraf.io/timesheet to the deployment

**This step is not done yet and the app is not reachable at the
production URL until it is.**

The app is built to live at the `/timesheet` sub-path — `vite.config.ts`
sets `base: "/timesheet/"`, the bundle is emitted to `dist/timesheet/`,
the router is mounted at `/timesheet`, and the browser calls
`/timesheet/api/*`. So the Vercel deployment already serves the whole
app under `/timesheet`:

```
https://kubegraf-timesheet.vercel.app/timesheet/login
https://kubegraf-timesheet.vercel.app/timesheet/api/auth/me
```

`kubegraf.io` is a *different* site (Firebase Hosting behind
Cloudflare), so the last hop is a routing rule on whatever fronts
`kubegraf.io`. **Forward the path unchanged** — `/timesheet/x` must
arrive as `/timesheet/x`, not `/x` — because the asset and API URLs
in the built HTML already carry the prefix.

Pick whichever matches how kubegraf.io is served:

**Cloudflare** — Rules → Origin Rules (or a Worker):
match `kubegraf.io/timesheet*` → proxy to
`kubegraf-timesheet.vercel.app`, preserving the path.

**Firebase Hosting** — `firebase.json` on the marketing site:

```json
{ "hosting": { "rewrites": [
  { "source": "/timesheet/**", "run": { ... } }
] } }
```

Firebase can only rewrite to Cloud Run / Functions, not an arbitrary
host, so on Firebase the Cloudflare rule is the simpler route.

**Verify** after the rule is live:

```sh
curl -sI https://kubegraf.io/timesheet/login | head -1          # 200
curl -s  https://kubegraf.io/timesheet/ | grep -o '<title>.*'   # Internal Time Sheet
curl -s -o /dev/null -w '%{http_code}\n' \
     https://kubegraf.io/timesheet/api/auth/me                  # 401
```

If the title still reads "AI SRE platform", the request is still being
served by the marketing site and the rule hasn't taken effect.

## 3. Verify after deploy

In a fresh browser (or incognito):

1. Open `https://kubegraf.io/timesheet/login`.
2. Click **Sign up** → enter `prajol@kubegraf.io` + your password.
3. Click **Sign in** as **Admin** with the same credentials → should land in `/manage`.
4. Sign out → sign back in → should still work.

If any step fails, check **Vercel → Deployments → [latest] → Functions** logs.

## 4. Backups

Sign in as an admin and open:

```
https://kubegraf.io/timesheet/api/users?export=workbook
```

That downloads the entire store as `timesheet-YYYY-MM-DD.xlsx` — one
sheet per entity. Save it somewhere off Vercel (Google Drive, a private
repo, anywhere). **Monthly habit** is plenty.

You get a second layer for free: the store keeps its last 10 snapshots
and 24 hours of journal entries, so point-in-time recovery is possible
without any backup at all — see §8.

## 5. Common operations

| Task | Action |
|---|---|
| Add an admin manually | Sign in as an existing admin → **Manage** → click the user → **Promote to Admin**. |
| Download the whole database | Admin → `GET /api/users?export=workbook` (see §4). |
| Check store health | `node --env-file=.env.local node_modules/.bin/tsx scripts/compact-xlsx-store.ts --status` |
| Rotate the blob token | Vercel → Storage → Blob → regenerate → update `BLOB_READ_WRITE_TOKEN` → redeploy. |
| Force everyone to sign out | Change `JWT_SECRET` in Vercel → redeploy. |
| Reset someone's password | Manage page → user → **Set password** (immediate) or **Email reset link** (sends a 24h link, requires `GMAIL_*` env). |
| Disable an employee | Manage page → user → **Disable login**. Blocks them from signing in without deleting data. |

## 6. Limits to watch on free tiers

- **Vercel Blob**: 1 GB storage / 10 GB bandwidth per month on Hobby. A workbook for ~30 employees is well under a megabyte, and snapshots are capped at 10, so storage is a rounding error. There is **no record cap** — that was the Airtable limit this replaced.
- **Vercel Hobby**: 100 GB bandwidth/month, and a **12 serverless function ceiling**. The project sits at exactly 12 — adding any new file under `api/` (other than `api/_lib/`) breaks the deploy. That is why the workbook export lives at `GET /api/users?export=workbook` rather than its own route.

## 7. Local dev

`.env.local` already contains the credentials. To run locally:

```sh
# vercel dev needs the env vars in its own shell environment
set -a; . ./.env.local; set +a
npm run dev:vercel   # vercel dev --listen 5050
```

Open http://localhost:5050/timesheet/ — dev uses the same `/timesheet`
mount path as production, so sub-path bugs surface locally rather than
after a deploy. The bare root redirects there in production.

To verify the API end-to-end after a change:

```sh
SMOKE_ALLOW_WIPE=1 node --env-file=.env.local scripts/smoke-test.mjs
```

⚠️ **The smoke test deletes every row in the configured store before
running.** It refuses to run without the explicit `SMOKE_ALLOW_WIPE=1`
env var to prevent accidents — but if your dev `.env.local` points at
the production store (which is the default after `vercel env pull`),
the wipe will hit production data.

**Best practice:** set `XLSX_STORE_PREFIX=dev` in `.env.local` so local
runs get their own namespace inside the blob store. Production lives
under `db/` and stays untouched.

To verify the storage layer specifically — field round-trips, cold
reads, concurrent writers, compaction, deletes — run:

```sh
node --env-file=.env.development.local node_modules/.bin/tsx scripts/verify-xlsx-store.ts
```

That one is always safe: it generates its own throwaway
`verify-<timestamp>/` namespace and deletes everything it created on
the way out, including after a failure. It never touches `db/`.

## 7b. Restoring the data from Airtable

Two routes. Prefer the API one; fall back to CSV when the API is blocked.

**API (clean, but needs quota):**

```sh
npm run db:migrate              # dry run — reads Airtable, writes airtable-export.xlsx locally
npm run db:migrate -- --commit  # writes the snapshot
```

**CSV (works when the API is hard-blocked):** Airtable's monthly API
request cap returns `PUBLIC_API_BILLING_LIMIT_EXCEEDED` and blocks the
script above for the rest of the billing month. Downloading a CSV from
the Airtable **web UI** does not touch that quota, so this still works:

1. airtable.com → open the base → pick a table → top-right ••• → **Download CSV**
2. Repeat for all seven: Users, Tasks, TimeEntries, Invitations, Notifications, Queries, Holidays
3. Put them in one folder, then:

```sh
npm run db:import-csv -- --dir ~/Downloads/airtable
npm run db:import-csv -- --dir ~/Downloads/airtable --commit
```

**Unattended (waiting out the quota):** a LaunchAgent can do the
waiting for you — it probes Airtable every 6 hours, does nothing while
blocked, and runs the migration the moment the API answers, then
uninstalls itself.

```sh
scripts/install-airtable-watcher.sh             # install (+ probe once now)
scripts/install-airtable-watcher.sh --status    # loaded? migrated yet?
scripts/install-airtable-watcher.sh --uninstall # cancel
tail -f .airtable-migrate.log                   # what it has been doing
```

It targets the production `db/` namespace and only commits if the
migration's guards pass: non-zero records, at least one ADMIN, and at
least one user with a password hash. Any guard failing means it writes
nothing and notifies instead — a half-readable Airtable can never
replace the store with a husk.

**Logins survive either route.** `passwordHash` is a plain-text column
in Airtable, so it round-trips through CSV intact — employees keep
their existing passwords, with no resets and no re-invites. Both
scripts report how many users arrived with a usable hash, and how many
admins, before you commit. Users with no hash (invited but never set a
password) need **Set password** or an email reset link, exactly as
before.

⚠️ `airtable-export.xlsx` and any downloaded CSVs **contain password
hashes**. Both are gitignored; delete them once the import is done.

## 7c. Setting up Google Sheets storage

One-time, and the only part nobody can do for you — a service account
is a Google Cloud identity.

1. **console.cloud.google.com** → create (or pick) a project
2. **APIs & Services → Library** → enable **Google Sheets API**
3. **IAM & Admin → Service Accounts** → create one → **Keys → Add key →
   JSON**. Download it.
4. Create a Google Sheet. Copy its id out of the URL.
5. **Share** that sheet with the service account's `client_email`, as
   **Editor**. A service account is a separate identity — it cannot see
   your Drive otherwise, and skipping this is the usual cause of a 403.
6. Put `client_email`, `private_key` and the sheet id into the env vars
   in §1, then:

```sh
npm run sheets:setup        # creates the tabs, verifies access
npm run sheets:setup -- --status   # read-only check
```

`sheets:setup` is safe to re-run: it only creates tabs that are
missing and never touches existing data. If anything is wrong it says
which piece — missing env var, unshared sheet, bad sheet id — rather
than failing somewhere deep in a migration.

## 7d. How the Google Sheets store works

Tabs: one per entity (`Users`, `Tasks`, `TimeEntries`, …) plus
`_Journal` and `_Meta`.

The naive design — find the row, write that range — loses updates when
two functions do it at once, exactly as the old blob backend did.
Sheets has no compare-and-swap either. But `values.append` resolves the
insertion point *server-side*, so two simultaneous appends produce two
rows, never one clobbering the other.

So every write is one append to `_Journal`. Reads load the entity tabs
and replay the journal tail on top. `_Meta.journalRows` records how
much of the journal is already folded in, so only the tail is ever
fetched and read cost stays flat as the journal grows.

**Compaction** (`npm run sheets:compact`, ideally a nightly cron) folds
the journal into the entity tabs and advances the watermark. It writes
the tabs *first* and the watermark *last*, so a run that dies halfway
replays rather than loses. It never deletes journal rows — the journal
is the recovery material. Run it from one place at a time.

**Quotas.** This is the real reason Sheets beats Airtable here: Sheets
limits are per-minute and a 429 clears in seconds (and is retried
automatically). Airtable's cap is per-*month*, and hitting it took the
app down for a billing cycle.

**Switching back.** `STORAGE_DRIVER=xlsx` moves the app onto the Excel
store in Vercel Blob without deploying anything. Both drivers share one
schema (`api/_lib/store-schema.ts`), so they cannot drift.

**Tests.** `npm run sheets:verify` exercises journal replay, the
compaction watermark, 25 concurrent writers, deletes and a corrupt
journal row against an in-memory spreadsheet — no Google account
needed. `npm run db:verify` does the same for the Excel driver against
real Vercel Blob in a throwaway namespace.

## 8. How the Excel store works

Worth understanding before you debug it. Full detail is in the header
comment of `api/_lib/xlsx-store.ts`; the short version:

Serverless functions have no durable disk, so the workbook lives in
Vercel Blob. The obvious design — fetch the .xlsx, edit it, upload it —
is what this project ran before Airtable, and it **lost writes**: two
functions saving at the same time each upload a copy based on their own
stale read, and whoever finishes last wins. Vercel Blob has no
compare-and-swap, so there's no way to make that safe.

So writes never touch the workbook:

```
db/snap-<watermark>-<rand>.xlsx   immutable snapshot, one sheet per entity
db/journal/<ts>-<rand>.json       immutable record of one commit
```

- **read** — newest snapshot + every journal entry newer than its watermark
- **write** — upload one new journal blob; nothing is overwritten, so simultaneous writers cannot clobber each other
- **compact** — fold the journal into a fresh snapshot, then garbage-collect

Every blob is write-once with a unique name, which also sidesteps CDN
staleness (Vercel Blob can't cache for less than 60s, and `list()` is a
direct API call, so discovery is always current). There is deliberately
no mutable pointer file — the live snapshot is whichever has the
highest watermark.

**Recovery.** The last 10 snapshots and 24 hours of journal entries are
retained. To roll back, delete the snapshots newer than the one you
want; the next read picks the highest remaining watermark and replays
the journal over it.

**Compaction** happens opportunistically once the journal passes 50
entries. `npm run db:compact` forces it — useful for a quiet store, or
as a nightly cron.
