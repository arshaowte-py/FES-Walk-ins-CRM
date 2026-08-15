# Frido Store Leads — setup

A small CRM that gives each store a private view of its own walk-in leads,
gated by a 4-digit code. Built for the Freedom Sale re-conversion push.

Two steps: connect the Google Sheet, then deploy. Budget about 20 minutes.

---

## Step 1 — Create the Google Sheet

1. Go to [sheets.new](https://sheets.new) and name it **Frido Store Leads**.
2. **File → Import → Upload**, choose `Frido_Leads_CRM_Sheet.xlsx`, and pick
   **Replace spreadsheet**. You now have three tabs: `Leads`, `Stores`,
   `Updates`.
3. Copy the Sheet ID out of the URL — it's the long string between `/d/` and
   `/edit`:
   `docs.google.com/spreadsheets/d/`**`1a2b3c...`**`/edit`

**What each tab is for**

| Tab | Who writes it | Notes |
| --- | --- | --- |
| `Leads` | You | Paste a fresh Zoho export here whenever you want. The app only reads it. |
| `Stores` | You | Store names and their 4-digit codes. Set `active` to `FALSE` to cut a store off. |
| `Updates` | The app | Append-only call log. Don't sort or edit it by hand. |

---

## Step 2 — Give the app access to the Sheet

The app signs in as a Google "service account" — a robot user with access to
this one Sheet and nothing else.

1. Open [console.cloud.google.com](https://console.cloud.google.com) and create
   a project (call it `frido-leads`).
2. **APIs & Services → Library**, search **Google Sheets API**, click **Enable**.
3. **APIs & Services → Credentials → Create credentials → Service account**.
   Name it `frido-leads-app`, then **Create and continue → Done**.
4. Click the new service account → **Keys → Add key → Create new key → JSON**.
   A `.json` file downloads. Open it in any text editor.
5. From that file you need two values: `client_email` and `private_key`.
6. Back in your Google Sheet, click **Share**, paste the `client_email` address,
   give it **Editor**, and untick "Notify people".

> The app needs Editor because it appends to the `Updates` tab. It can only
> touch Sheets you've explicitly shared with it.

---

## Step 3 — Deploy to Vercel

1. Push this folder to a GitHub repo.
2. At [vercel.com/new](https://vercel.com/new), import that repo. Framework is
   detected as Next.js — leave the build settings alone.
3. Before clicking Deploy, open **Environment Variables** and add these five:

| Name | Value |
| --- | --- |
| `SESSION_SECRET` | Any long random string. Run `openssl rand -hex 32` to make one. |
| `GOOGLE_SHEET_ID` | The ID from Step 1. |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | The `client_email` from the JSON key. |
| `GOOGLE_PRIVATE_KEY` | The whole `private_key` value, including the `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` lines. Paste it exactly as it appears in the JSON, `\n` escapes and all. |
| `ADMIN_CODE` | Unlocks `/admin`, the area-manager view. Make it long — `openssl rand -hex 16`. Leave it out and `/admin` stays shut. |

Framework preset is **Next.js**, build command `next build`, output directory
`.next` — all detected automatically. There's nothing to configure beyond the
variables above.

4. **Deploy.** You get a URL like `frido-leads.vercel.app`. That's what goes to
   the stores. The area manager gets the same URL with `/admin` on the end.

> Changing `SESSION_SECRET` later signs everyone out, stores and admin alike.
> That's the fastest way to revoke access if a code leaks mid-sale.

### If `GOOGLE_PRIVATE_KEY` gives you trouble

It's the one that usually does. The JSON file contains the key as a single line
with literal `\n` sequences in it. Copy the value between the quotes, without
the surrounding quotes. The app converts the `\n` back into real line breaks.

---

## Running it locally first

```bash
npm install
cp .env.example .env.local     # then fill in the values
npm run dev
```

Open http://localhost:3000. With `GOOGLE_SHEET_ID` left blank the app runs off
the bundled snapshot in `/data` so you can click around — but status changes
won't persist. It says so in a banner.

---

## Day-to-day

**Loading a fresh Zoho export.** Export from Zoho, run it through
`prep_data.py` to normalise store names and re-tier priorities, then paste the
result over the `Leads` tab. Keep the `lead_id` column — it's how the `Updates`
log stays attached to the right person. Never clear the `Updates` tab; it's
your call history.

**Seeing what stores have done.** The `Updates` tab is the record: every status
change and note, with a timestamp and whoever typed their name in. A pivot over
`store_id` and `status` gives you a live conversion board.

**Changing a store's code.** Edit `access_code` in the `Stores` tab. It takes
effect within five minutes (that's the read cache).

**Cutting access off after the sale.** Set `active` to `FALSE` for every store
in the `Stores` tab, or just delete the Vercel deployment.

---

## How it holds up with 20 stores at once

- **Reads are shared.** The whole `Leads` tab is fetched once and cached for
  five minutes, then sliced per store in memory. Twenty people refreshing at
  the same moment cost one API call, not twenty — this is what keeps you clear
  of Google's rate limits.
- **Writes are append-only.** A status change appends a row to `Updates`; it
  never edits a row in place. Two stores saving at the same instant cannot
  overwrite each other, and re-importing the `Leads` tab underneath can't
  corrupt the history. Current status is simply the newest row for that lead.
- **Stale beats broken.** If Sheets hiccups, the app serves the last good copy
  rather than erroring at someone mid-call.

Tested with 20 stores signed in simultaneously and 100 concurrent writes: no
lost updates, no cross-store leakage.

---

## A note on the 4-digit code

It's 10,000 combinations, so it's a soft lock, not a real one. Login is
throttled to 12 wrong attempts per IP per 10 minutes, which turns a brute-force
attempt into days rather than minutes. That's proportionate for a sale-window
tool holding customer phone numbers, but two things are worth doing:

- Send the URL and the code together, privately, to a named person per store —
  don't post it in a broadcast group.
- Set every store to `active = FALSE` once the sale ends.

If this becomes a permanent tool rather than a campaign one, move to 6-digit
codes (a one-character change in `lib/data.js`) or per-person logins.
