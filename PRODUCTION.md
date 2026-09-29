# Production deployment checklist

This app is fully wired against an Airtable backend. Once the env vars
below are set in Vercel and you push to your main branch, the deployed
site is the production app — `prajol@kubegraf.io` signs in as the
bootstrap admin, employees sign up themselves with `@kubegraf.io`
addresses.

## 1. Set environment variables in Vercel

Go to **vercel.com → your project → Settings → Environment Variables**.
Add the following, scoped to **Production** (tick **Preview** too if
you want preview deploys to share the same Airtable base — usually
fine for an internal tool):

| Name | Value | Notes |
|---|---|---|
| `AIRTABLE_TOKEN` | `pat...` (the token you generated) | Treat like a password. Rotate from airtable.com/create/tokens if it leaks. |
| `AIRTABLE_BASE_ID` | `app0zBhig6cVzCTvi` | The KubeGraf Time Sheet base ID. |
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

Airtable doesn't auto-back-up free-tier bases. **Monthly habit**:

1. Open the base at https://airtable.com/app0zBhig6cVzCTvi.
2. Top-right menu → **Download CSV** for each table (Users, Tasks, TimeEntries, Holidays, Invitations, Notifications).
3. Save the CSVs somewhere durable (Google Drive, GitHub repo, anywhere off Airtable).

For automated backups, the simplest path is a GitHub Actions cron that
calls `node scripts/setup-airtable.mjs` style export logic — ask later
if you want it.

## 5. Common operations

| Task | Action |
|---|---|
| Add an admin manually | Sign in as an existing admin → **Manage** → click the user → **Promote to Admin**. |
| Rotate the Airtable token | airtable.com/create/tokens → regenerate → update `AIRTABLE_TOKEN` in Vercel → redeploy. |
| Force everyone to sign out | Change `JWT_SECRET` in Vercel → redeploy. |
| Reset someone's password | Manage page → user → **Set password** (immediate) or **Email reset link** (sends a 24h link, requires `GMAIL_*` env). |
| Disable an employee | Manage page → user → **Disable login**. Blocks them from signing in without deleting data. |

## 6. Limits to watch on free tiers

- **Airtable**: 1,000 records per table. If `TimeEntries` approaches that (~30 employees × 30 entries/month ≈ 900/month), you'll need either a cleanup cron (archive old months) or a paid plan or a real DB.
- **Vercel Hobby**: 100 GB bandwidth/month — generous for an internal tool. Hobby plan is fine indefinitely.

## 7. Local dev

`.env.local` already contains the Airtable creds. To run locally:

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

⚠️ **The smoke test deletes every row from every Airtable table in
the configured base before running.** It refuses to run without the
explicit `SMOKE_ALLOW_WIPE=1` env var to prevent accidents — but if
your dev `.env.local` points at the same Airtable base as production
(which is the default after `vercel env pull`), the wipe will hit
production data.

**Best practice:** create a separate "dev" Airtable base, copy its
ID into `.env.local` as `AIRTABLE_BASE_ID`, run `node --env-file=.env.local
scripts/setup-airtable.mjs` to create the schema there, and run the
smoke test against that. Production stays untouched.
