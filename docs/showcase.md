# Login-free portfolio showcase

Vercel builds `npm run build:demo` into `dist-demo`. It needs no Google account,
Google configuration or Apps Script deployment. Choose a demo persona to explore
admin or member workflows. State is in memory, isolated per tab, and resets on reload.

11 first-string offensive players come from the official Jaguars depth chart
fetched November 7, 2026. The official chart lists two first-string running backs; Alec requested just
one, so this showcase includes first-listed Bhayshul Tuten and omits Chris Rodriguez Jr.
Backups, reserves and practice-squad players are omitted. Headshots are bundled
local assets; no third-party photo fetches are required. Provenance is recorded
in `jaguars-photo-provenance.csv`. The project claims no image ownership,
endorsement or license. Degrees and graduation years are fictional examples.
Attendance is an example; no initial player ratings or notes are seeded.

## Real DSP setup later

`npm run build` still builds the Google-authenticated live application into
`dist`. A real chapter deployment must serve that artifact with its own Google
and Sheets configuration, not reuse this demo build. Backend auth remains
unchanged. This is not a chapter production deployment.

## Verification

Run `npm run ci`. Open the demo build without a signed-in Google session.
Choose each persona, verify headshots, cast a local vote, inspect analytics,
and reset. No Google identity or Apps Script endpoint belongs in this artifact.
