# Deployment Guide
## Recruitment Tracker — Vercel + Supabase

Estimated setup time: ~20–30 minutes.

---

## What you need (all free)
- [Supabase account](https://supabase.com)
- [Vercel account](https://vercel.com)
- [GitHub account](https://github.com)

---

## Step 1 — Create your Supabase project

1. Sign in to [supabase.com](https://supabase.com) → **New project**.
2. Give it a name (e.g. "recruitment-tracker"), choose a region close to you.
3. Wait ~2 minutes for it to provision.

---

## Step 2 — Run the database schema

1. In your Supabase project, go to **SQL Editor** in the left sidebar.
2. Click **New query**.
3. Open `supabase-schema.sql` from this folder, copy everything, paste it in, and click **Run**.
4. You should see "Success. No rows returned."

---

## Step 3 — Configure invite-only auth

1. Go to **Authentication → Providers** → make sure **Email** is enabled.
2. Go to **Authentication → Settings**:
   - Set **"Enable email confirmations"** → ON
   - Set **"Enable sign ups"** → **OFF** (this means only people you invite can create accounts)
3. Save.

---

## Step 4 — Copy your API keys

1. Go to **Settings → API**.
2. Copy:
   - **Project URL** — looks like `https://abcdefgh.supabase.co`
   - **anon/public key** — the long string under "Project API Keys"
3. Keep these handy for Step 7.

---

## Step 5 — Push code to GitHub

In the project folder (this folder), run:

```bash
git init
git add .
git commit -m "initial commit"
```

Then go to [github.com/new](https://github.com/new), create a new **private** repository,
and follow the instructions GitHub shows you to push your existing repo.

---

## Step 6 — Deploy to Vercel

1. Go to [vercel.com](https://vercel.com) → **Add New → Project**.
2. Import your GitHub repository.
3. Vercel will auto-detect Vite. Leave the build settings as-is.
4. Under **Environment Variables**, add two variables:
   | Name | Value |
   |------|-------|
   | `VITE_SUPABASE_URL` | your Supabase Project URL |
   | `VITE_SUPABASE_ANON_KEY` | your Supabase anon key |
5. Click **Deploy**.
6. Once done, copy your live URL (e.g. `https://your-app.vercel.app`).

---

## Step 7 — Add your Vercel URL to Supabase

1. In Supabase, go to **Authentication → URL Configuration**.
2. Set **Site URL** to your Vercel URL: `https://your-app.vercel.app`
3. Under **Redirect URLs**, add the same URL.
4. Save.

---

## Step 8 — Make yourself admin

1. Go to `https://your-app.vercel.app` and sign in with your email.
2. Check your email and click the magic link.
3. Back in Supabase, go to **Table Editor → profiles**.
4. Find your row (it will have your email) and change `role` from `brother` to `admin`.
5. Save. Refresh the app — you'll now see the Admin dashboard.

---

## Day-to-day usage

### Inviting brothers
1. Supabase → **Authentication → Users → Invite user**.
2. Enter each brother's email and click Invite.
3. They'll get an email with a link to set up their account.
4. Share your Vercel URL (`https://your-app.vercel.app`) as the bookmark to send them.

### Before each recruitment event
1. Log in as admin → **Events tab** → add the event name.

### After each event
1. Brothers go to the app, select the event, tap ✓ or ✗ for each recruit.
2. Votes save instantly. Brothers can change their vote anytime.

### Reviewing recruits
1. Admin → **Dashboard tab** — recruits sorted by net score.
2. Expand any recruit to add/edit comprehensive notes.

---

## Troubleshooting

**"Invalid login credentials" or magic link not working**
→ Make sure the Redirect URL in Supabase matches your Vercel URL exactly (no trailing slash).

**Brother can't sign in**
→ Make sure you invited them via Supabase → Authentication → Users → Invite user.
   Also confirm "Enable sign ups" is OFF (so the invite path is used).

**Admin sees "no votes" even after brothers voted**
→ Check that the SQL schema ran successfully (go to Table Editor and look for the `votes` table).

**Votes not saving**
→ Open browser DevTools → Console and look for Supabase errors. Usually a misconfigured env variable.
