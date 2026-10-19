# Recruitment Tracker (Google Sheets)

Free, no-pause recruitment voting app for Delta Sigma Pi chapters. Uses a Google Sheet as the database and Google Sign-In. Designed so a non-technical officer can run it after a one-time setup.

## One-time setup (do this once under the chapter Google account)

1. Create a new Google Sheet. Name it something like "DSP Recruitment Tracker".
2. Go to **Extensions → Apps Script**.
3. Delete any default code and paste the entire contents of `apps-script/Code.gs` from this repo.
4. Click the disk icon to save.
5. Click **Deploy → New deployment → Select type: Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Authorize when prompted. Copy the **Web app URL**.
7. In this repo, create a `.env` file (or set the Vercel env var):
   ```
   VITE_APPS_SCRIPT_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
   VITE_GOOGLE_CLIENT_ID=your-google-oauth-client-id.apps.googleusercontent.com
   ```
8. Deploy the frontend to Vercel (or any static host). The first person who signs in with Google becomes the admin.

### Google OAuth Client ID
- Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials.
- Create an OAuth 2.0 Client ID (Web application).
- Add your Vercel domain (and `http://localhost:5173` for local dev) to Authorized JavaScript origins.
- Copy the Client ID into the env var above.

## Day-to-day (non-technical)

- **Brothers**: Open the app link, sign in with Google, select an event, rate each recruit 1–10.
- **Admins**:
  - Add/remove recruits and events.
  - Take attendance so only present recruits appear for voting.
  - Write notes.
  - Manage users (add by email, change role to admin/brother, remove).
  - At the end of the cycle, click **Wipe Cycle** (clears recruits, events, votes, and notes; keeps the user list).

## Annual handoff

1. Current admin promotes the new officers to admin inside the app.
2. Current admin removes themselves if desired.
3. Share the app URL. The Google Sheet stays owned by the permanent chapter account.

No one ever needs to open Apps Script, Supabase, or any dashboard after the initial setup.

## Local development

```bash
npm install
npm run dev
```

Set the two env vars in `.env.local`.
