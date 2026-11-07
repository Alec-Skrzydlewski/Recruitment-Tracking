# Recruitment Tracker

A small, free-to-run recruitment voting app for a student business organization.
Members sign in with Google, pick an event, and rate the recruits who attended.
Admins manage recruits, events, attendance and the member list, and see live
averages. The backend is a Google Sheet plus a Google Apps Script web app, so a
volunteer officer can operate it without servers, databases or a budget.

> **Try the demo:** `npm ci && npm run dev:demo`, then open the printed
> localhost URL and choose a persona. The demo runs entirely in your browser on
> fictional data. It needs no sign-in, backend, or network.

<!-- OWNER: add a sentence on your role/motivation and a hosted demo link here once published. -->

## Contents

- [What it does](#what-it-does)
- [Architecture](#architecture)
- [Security and data-integrity controls](#security-and-data-integrity-controls)
- [Data model and tally rules](#data-model-and-tally-rules)
- [Running locally](#running-locally)
- [Backend setup (live mode)](#backend-setup-live-mode)
- [Upgrading an existing v2 deployment](#upgrading-an-existing-v2-deployment)
- [Testing and CI](#testing-and-ci)
- [Known limitations and deferred work](#known-limitations-and-deferred-work)
- [Owner decisions before publishing](#owner-decisions-before-publishing)

## What it does

| Role | Can do |
| --- | --- |
| Member | Choose an event, rate each recruit marked present (1–10). Sees only their own scores. |
| Admin | Add or remove recruits (name, major and graduation year required; photo optional). Create events and take attendance. Write notes. Manage members and admins. Review averages, and each recruit's detailed results on the **Analytics** tab. Wipe a cycle at year end. |
| Owner (backend setting) | Initializes the Sheet schema and becomes the first admin of an empty deployment. |

## Architecture

```
Browser (React 18 + Vite SPA)
  ├─ live runtime ─ Google Identity Services ─► ID token
  │                 └─ POST text/plain JSON {apiVersion, action, token, …}
  │                        ▼
  │      Apps Script web app (apps-script/Code.gs)
  │        verify token with Google (aud/iss/exp/email_verified)
  │        → authorize (active member / admin / owner)
  │        → validate input → LockService → name-indexed Sheet writes
  │        → private Drive folder for photos (explicit admin actions only)
  │
  └─ demo runtime ─ in-memory backend (src/demo/) with the same rules,
                    fictional seed data, generated SVG avatars, no network
```

- **One UI, two runtimes.** Pages (`src/pages/`) get `api`, `me` and
  `loadPhotos` from a `RuntimeContext`. They don't know whether they are
  talking to Apps Script or to the in-memory demo. `VITE_APP_MODE=demo`
  selects the demo at build time. Vite inlines that value, so the demo
  bundle contains no Google or Apps Script code. `scripts/check-bundle.mjs`
  checks this in CI.
- **Why Sheets and Apps Script:** there is no hosting cost, no database to
  maintain, and officers can inspect the data directly. The tradeoffs are
  per-request latency, a single script lock for writes, and Apps Script
  quotas. The code keeps lock sections short and does Drive work outside the
  lock.
- **Why `text/plain`:** Apps Script web apps do not answer CORS preflight
  requests. The JSON body is sent as `text/plain`, so the browser skips the
  preflight.
- **Admin is code-split** (`React.lazy`), so voters never download it.

## Security and data-integrity controls

Implemented and covered by tests (`tests/code-gs-security.test.mjs`, `tests/code-gs.test.mjs`):

- **Token binding.** Google's `tokeninfo` endpoint verifies every ID token.
  The server then requires `aud` to equal the configured `GOOGLE_CLIENT_ID`,
  plus a Google `iss`, `email_verified`, and an unexpired `exp`. A valid
  Google token issued to a different app is rejected.
- **Fail closed.** If `GOOGLE_CLIENT_ID` is missing, every request is
  refused. If `OWNER_EMAIL` is missing, nobody can initialize an empty
  deployment. Requests without the current `apiVersion` are refused, which
  keeps outdated clients from writing.
- **No first-visitor admin.** Only `OWNER_EMAIL` can become the first admin
  or run schema setup.
- **Authorization matrix.** Each action is tagged as member, admin or owner.
  Unknown and inactive identities can't reach any action. Members can't
  reach admin actions. Tests cover every action for every role and confirm
  that nothing was written.
- **Vote integrity.** Inside the write lock, `castVote` re-checks active
  membership, that the event and recruit exist, and that the recruit was
  marked present. Any failure returns before a cell is written. Each
  member, event and recruit has one vote, updated in place.
- **Spreadsheet-safe writes.** Text that starts with `= + - @` (or tab or
  carriage return) is written with a leading apostrophe, so Sheets stores it
  as literal text and never evaluates it as a formula. IDs must match
  `[A-Za-z0-9_-]{1,64}`. Names, majors, notes, emails, roles and graduation
  years are validated and length-capped on the server.
- **Name-indexed schema.** Reads and writes find columns by header name.
  Reordered or legacy extra columns are handled. A missing or duplicate
  required column is a setup error and changes no data. Normal requests
  never modify the schema; only the owner's explicit **Initialize sheets**
  action does.
- **Sanitized errors.** The browser receives stable `{ error, code }`
  values. Raw Google or Drive exceptions are logged server-side only. A
  missing Drive grant shows a photo-only warning, and the rest of the app
  keeps working.
- **Photos stay private.** Drive files are never shared. Members can fetch
  only images linked to a recruit row. Admins can also preview unlinked
  images inside the private **Recruit Photos** folder. Opening Admin never
  touches Drive: folder sync and folder creation happen only when an admin
  clicks **Sync photo folder** or uploads a photo.
- **Client session hygiene.** Photos are cached in memory only, scoped to
  the signed-in account, and capped in size. They are cleared on sign-out,
  token expiry, or an account or runtime switch. Requests time out after
  20 s, and writes are never retried automatically.
- **Guarded wipe.** The wipe is in **Settings**, not the header. It requires
  typing `WIPE CYCLE` and sends a SHA-256 fingerprint of the recruits,
  events, attendance, votes and notes as last loaded. The server recomputes
  it under the write lock and refuses on any difference, including same-count
  edits such as a re-scored vote, an edited note, or a delete plus an add, and
  the admin's own edits since loading. The page then reloads for review. It is
  also blocked while other edits are still saving.
- **Authority re-checked under the lock.** Every admin write re-reads the
  Users sheet after acquiring the script lock (and after any Drive work), so
  an admin demoted or removed mid-request cannot complete a write.
- **Idempotent creates.** Add recruit and add event take a `requestId`. The
  replay key is action + caller email + request ID and is checked and stored
  while the lock is held, after the admin re-check, so a cached replay never
  bypasses a revocation. Replay protection is best-effort: entries are
  stored with a 600-second expiry, but CacheService may evict them sooner, so
  there is no guaranteed 10-minute window. After eviction a retry creates a
  second row. Because Add recruit checks the cache before its Drive upload,
  an entry that expires between that check and the lock can produce a second
  row without its photo, and two racing identical uploads can orphan a Drive
  file. The script lock serializes this app's own requests only, not direct
  edits in the Sheet UI or other projects.
- **HTTP headers** (`vercel.json`, tested in `tests/headers.test.mjs`):
  - The CSP allows only `self`, the Google Identity Services endpoints, and
    Apps Script, with no `unsafe-inline` or `unsafe-eval`.
  - `frame-ancestors 'none'`, `nosniff`, a strict referrer policy, and a
    restrictive Permissions-Policy.
  - `Cross-Origin-Opener-Policy: same-origin-allow-popups`, which the Google
    sign-in popup needs.

Privacy notes: members' own scores are visible only to them; admins see all scores
(needed for deliberation). Deleting a recruit or event, or marking a recruit
absent, permanently deletes the affected votes (see below). There is no vote
archive or history.

## Data model and tally rules

Six sheets. Columns are located by header name; extra columns are allowed.

| Sheet | Required columns |
| --- | --- |
| Users | email, name, role (`admin`/`brother`), active (`yes`) |
| Recruits | id, name, major, secondMajor, gradYear, photoFileId, photoSource |
| Events | id, name, optional `date` |
| EventRecruits | eventId, recruitId (presence = attended) |
| Votes | eventId, recruitId, userEmail, score (1–10), timestamp |
| Notes | recruitId, content, updatedAt |

**Event dates (optional).** `Events.date` holds a date-only `YYYY-MM-DD` value stored as literal text. It is not required: sheets without the column keep working and events read as "Date not set". Setup does not add it; the first time an admin saves an event with a date, the backend appends a `date` header in a new column beyond the sheet's full used range (under the admin lock), touching no existing cell. Date cells typed by hand are read in the spreadsheet time zone. Existing events are never backfilled.

**Votes and deletes** (`src/lib/tally.js`, `apps-script/Code.gs`):

- A vote counts when it has an integer 1–10 score for a recruit and an event
  that both exist, and the recruit is marked present at that event.
- Deletes cascade and are permanent; nothing is kept as history:
  - deleting an **event** deletes its votes and its attendance rows;
  - deleting a **recruit** deletes their votes, attendance rows and note
    (their Drive photo file is not deleted);
  - marking a recruit **absent** deletes every vote for that recruit at that
    event.
  Each confirmation dialog states how many votes will be permanently deleted.
  Votes by members who were later removed or demoted, and repeated votes,
  are not deleted by these rules.
- The tally still ignores any malformed row in the data it receives, as a
  defensive check, but there is no "excluded votes" count or category.
- **Invalid-vote cleanup** (Settings): data written before deletes cascaded
  can contain votes for a missing recruit, a missing event, a recruit not
  marked present, or with an invalid score. *Check for invalid votes*
  (`getVoteCleanup`) is read-only and returns counts per reason plus the
  cycle fingerprint. *Permanently delete N invalid votes*
  (`cleanupInvalidVotes`) requires an active admin re-checked under the
  write lock, the confirmation `DELETE INVALID VOTES`, and the previewed
  fingerprint and count; any change since the preview is refused. The
  criteria are computed on the server; the request cannot supply its own.
  Cleanup never runs automatically on load, setup or deploy.

**Idempotency and ordering:**

- Attendance is sent as the desired state (`present: true/false`), so a
  replayed request can't flip it back.
- Creating a recruit or event carries a `requestId`. A replay of the same
  action by the same admin normally returns the first result instead of
  adding a second row; this is best-effort (see *Idempotent creates* above).
- In the voting UI, writes for each recruit run one at a time and the last
  tap wins.

**Graduation year** is required when adding a recruit: the server (and the
demo) reject a missing, blank or non-4-digit year and anything outside the
existing 2000–2100 range, before any Drive upload. The form offers the
current year through eight years ahead. Existing rows without a year are
not changed and still display; Analytics shows "Graduation year not recorded" (and "no year" in the dropdown when names repeat).

## Analytics (admin only)

`/admin?tab=analytics` (linkable; every admin tab uses `?tab=`) shows **one
recruit at a time**. The only control is a recruit dropdown: all recruits,
alphabetical, option values are recruit IDs, and duplicate names get the
class year (and a short ID if still ambiguous). It opens on the first
recruit; if the selected recruit is deleted it falls back to the first.

For the selected recruit: mean, median, ballots, unique voters, sample SD
(n − 1, with 2+ ballots), range, events attended and rated, equal-event
mean, a 1–10 histogram with a data table, and a per-event breakdown (ballots,
voters, mean, median, SD, range, score counts) for events they attended or
were rated at. A "small" flag (< 3 ballots) is a reading aid, not a test.
There is no cohort ranking, filters, participation or cross-recruit
comparison on this page, no trends (events have no dates; vote timestamps
are last-edit times) and no individual voter data. A collapsible section
explains the calculations.

Computed in the browser from the same admin snapshot as the dashboard
(`buildRecruitAnalytics` in `src/lib/analytics.js`); no new backend action,
permission or dependency. **Export** downloads a CSV for the selected
recruit only (overall row + one row per event; no voter identities). It is
still private chapter data; cells are formula-guarded (leading `= + - @`,
also after spaces/NBSP) and quoted for `" , CR LF`, which reduces but cannot
rule out formula evaluation in every spreadsheet program.

## Running locally

Requires Node ≥ 20.19.

```bash
npm ci
npm run dev:demo      # fictional demo, no configuration needed
npm test              # all unit, backend, security and UI-flow tests
npm run ci            # lint + tests + live build + demo build + bundle isolation check
```

**Demo personas:**

- **Jordan Vale** (admin): dashboard, recruits, events and attendance,
  members, settings and wipe.
- **Riley Brooks** (member): voting.

Use **Reset demo data** in the purple ribbon to return to the seed. Data
lives only in the current tab.

Live mode locally: copy `.env.example` to `.env.local`, fill both values, then run `npm run dev`.
Without both values the live build shows "App not configured" and makes no requests.

## Backend setup (live mode)

Do this once, under the Google account that should own the data.

1. Create a Google Sheet. Open **Extensions → Apps Script**. The script must
   be bound to the Sheet.
2. Replace the default code with `apps-script/Code.gs`. Copy
   `apps-script/appsscript.json` into the manifest. It requests three scopes:
   - `spreadsheets`
   - `script.external_request`, for token verification
   - `drive`, needed by the current photo features: folder creation,
     uploads, and reading folder images. A read-only Drive variant is not
     implemented, because it would require disabling uploads and folder
     creation.
3. Under **Project Settings → Script properties**, add:
   - `GOOGLE_CLIENT_ID`: the OAuth web client ID the frontend uses.
   - `OWNER_EMAIL`: the Google account that initializes the workspace and
     becomes the first admin.
4. **Deploy → New deployment → Web app**. Set Execute as **Me** and Who has
   access **Anyone**. "Anyone" means anyone can reach the endpoint; every
   action still requires a token issued to your client ID by an authorized
   member. Copy the web app URL.
5. In Google Cloud Console → APIs & Services → Credentials:
   - Create a **Web application** OAuth client.
   - Add your site origin (and `http://localhost:5173` for development) to
     Authorized JavaScript origins.
6. Configure the frontend host:
   - `VITE_APPS_SCRIPT_URL`: the web app URL from step 4.
   - `VITE_GOOGLE_CLIENT_ID`: the same client ID as step 3.
   - Deploy with `npm run build`. `vercel.json` provides the SPA fallback
     and security headers.
7. Sign in as `OWNER_EMAIL`. If any sheet or column is missing, you'll see
   **Workspace setup needed**. Click **Initialize sheets**: it creates
   missing sheets and appends missing columns, and never reorders or deletes
   anything. Then add members in **Admin → Members**.

The demo build (`npm run build:demo`, output `dist-demo/`) is static and
needs neither value. Host it separately from any live deployment.

## Upgrading an existing v2 deployment

The frontend and backend are released as a pair: API version **2**, schema
version **2**.

1. Before deploying the new `Code.gs`, set `GOOGLE_CLIENT_ID` and
   `OWNER_EMAIL`. Without them the new backend refuses all requests.
2. Deploy the new `Code.gs` as a **new version** of the existing web app
   deployment, then deploy the matching frontend. An old frontend talking to
   the new backend gets "This page is out of date". A new frontend talking to
   the old backend fails on actions that were renamed, such as
   `setAttendance`. Deploy both together.
3. Existing sheets are not migrated or rewritten. Name-indexed access reads
   the current headers. If a required column is missing, the owner runs
   **Initialize sheets** once.
4. Existing invalid votes (from before deletes cascaded) are **not** touched
   by deploying or by **Initialize sheets**. After deploying, an admin may
   run **Settings → Check for invalid votes**, review the counts, and only
   then choose to delete them. Make a copy of the Sheet first if you want a
   restore point; the app keeps none.
5. Rollback: redeploy the previous Apps Script version together with the
   previous frontend build. Votes already deleted by cascades or by the
   cleanup are not restored by a rollback.

The Apps Script backend is deployed by hand as described above; nothing in
this repository's CI deploys it. The frontend is different: the repository
is connected to Vercel, which has created a **Production** deployment for
past commits on `main` and **Preview** deployments for branch pushes (per
GitHub deployment records). Assume merging to `main` deploys the production
frontend, so deploy and verify the backend (step 1) before merging.

## Testing and CI

`npm test` runs Node's built-in test runner:

| Suite | Covers |
| --- | --- |
| `code-gs-security.test.mjs` | Token audience, issuer and expiry; fail-closed config; owner-only bootstrap and setup; the full authorization matrix; vote membership, existence and attendance checks; formula-text writes; reordered and duplicate headers; sanitized Drive errors; idempotency keyed by action, caller and request ID under the lock (concurrent, evicted and cross-action replays); admin revocation before the write lock (incl. after Drive work); desired-state attendance; the content-fingerprint wipe guard including same-count stale changes; permanent vote cascades on event/recruit delete and absence with unrelated rows and Drive files preserved; read-only invalid-vote preview and the locked, fingerprint- and count-bound cleanup of exactly the four criteria |
| `analytics.test.mjs` | Exact analytics values: mean/median/SD/histogram, unequal event counts, equal-event vs all-ballot mean, duplicates, inactive-voter retention, invalid rows, empty cases; recruit dropdown order/labels/duplicates, default and removed-selection fallback; two recruits differ in every detail and in export scope; CSV CR/quote round-trip and formula guards |
| `code-gs.test.mjs` | Parity with the original behavior: vote upsert and dedupe, required graduation year (no write, no Drive upload) and legacy rows without one, user management guards, schema setup, photo upload, sync, link and folder rules |
| `responsive-css.test.mjs` | Phone layout guards (360–390px): file pickers cannot widen the page, header wraps into rows with one-line Sign out, admin tabs wrap, voting scale stays 2x5 |
| `ui-flows.test.mjs` | Real React pages in jsdom against the demo backend: persona flow, vote save, rollback and retry, note-failure draft retention, wipe guard, reset; Analytics tab (URL tab, single recruit dropdown, switching recruits, no cohort sections, deleted-selection fallback, no-recruit state, admin-only redirect, read failure); required graduation year in the add form. `fetch`, XHR, WebSocket, beacons and script injection are tripwires, and the tests assert zero network use. The unconfigured live app fails closed. |
| `frontend-libs`, `demo-backend`, `api`, `headers`, … | Tally rules, the write queue, the photo cache, transport errors and timeouts, demo-rule parity, and the CSP |

The suites use a synthetic in-memory Sheets, Drive, Lock and Cache
harness (`tests/helpers/gsHarness.mjs`). They do not prove how Google's
services behave in production, including real concurrency, quotas, or the
consent and scope state of a deployment.

CI (`.github/workflows/ci.yml`) runs lint, tests, the live build (with and
without placeholder configuration), the demo build, and the bundle isolation
check.

## Known limitations and deferred work

- **Thumbnails:** photos are served as compressed JPEG data URLs. Uploads
  are resized in the browser to ≤800 px and ≤300 KB, and only recruits shown
  for the selected event are requested. Images dropped into the Drive folder
  are not resized; server-side thumbnails are deferred.
- **Token verification** calls Google's `tokeninfo` endpoint on every
  request. Caching verified tokens is deferred until latency is measured.
- **Vote ordering:** writes are serialized per recruit in the client. There
  is no server-side version vector, so two devices for the same member are
  resolved last-write-wins.
- **Audit/export:** there is no separate audit log or export endpoint. The
  Sheet itself, with timestamps, is the record.
- **Dependencies:**
  - `npm audit --omit=dev` reports a moderate advisory in `react-router` 6.
    It concerns an open redirect through backslash paths and SSR hydration.
    The app navigates only to fixed internal paths and doesn't use SSR. The
    fix requires the v7 major upgrade, which is deferred.
  - Dev-only advisories in `vite`/`esbuild` affect the local dev server.
    Keep it bound to localhost; they don't ship in built assets.

## Owner decisions before publishing

These choices belong to the repository owner and are not made in this branch:

- **License:** none is selected, so default copyright applies until you add one.
- **Commit history and author metadata:** decide whether to publish this
  history as-is or a fresh snapshot.
- **Repository homepage link:** this currently points to a personal Vercel
  deployment. Replace it with the demo URL.
- **Hosted demo:** where to host `dist-demo/`, and the link to add above.
- **Contribution and contact section:** <!-- OWNER: add if desired -->

Branding note: the purple and gold accents are only inspired by the
organization's colors. This is not an official palette or logo, and the
project is not endorsed by any national organization or employer.
