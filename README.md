# Frido Store Leads

Per-store CRM for the Freedom Sale re-conversion push. Each of the 20 stores
enters a 4-digit code and sees only its own walk-in leads, sorted so the people
who walked away over price come first.

Setup and deployment: **[SETUP.md](./SETUP.md)**

## What a store person sees

Sign in with a 4-digit code, then a list of their leads with:

- **Hot / Warm / Cold tiers.** Hot means Zoho recorded the lost reason as
  "waiting for discount / offer / sale" or "out of budget" — the sale answers
  their exact objection, so they get called first.
- **One-tap Call and WhatsApp.** WhatsApp opens with a pre-written message that
  already names the customer and the product they were looking at.
- **Status and notes.** New / Interested / Callback Later / Not Reachable /
  Not Interested / Converted, plus a free-text note. Status saves the moment
  it's picked.
- **The original context** — what they came in for, the price, when they
  visited, what the store person wrote down at the time.

## Layout

```
app/
  page.jsx              login
  dashboard/page.jsx    the board (server-rendered, store scoped)
  api/
    login/              code -> signed cookie
    leads/              this store's leads only
    lead-update/        append a status change
components/
  LoginForm.jsx
  LeadBoard.jsx         filters, search, tabs
  LeadCard.jsx          one lead
lib/
  session.js            signed httpOnly cookie
  data.js               the one place store scoping is enforced
  sheets.js             Sheets client, caching, append-only writes
  ratelimit.js          login throttle
data/                   bundled snapshot, used when no Sheet is configured
```

## Where the store scoping lives

Only `getLeadsForStore(storeId)` in `lib/data.js` returns leads, and it filters
by `store_id` before anything else. `storeId` is read exclusively from the
signed cookie in `lib/session.js` — never from a request body or query string —
so a store can't reach another store's rows by editing a request. Writes
re-check that the lead belongs to the calling store before appending.

## Tests

`test_app.py` runs against a dev server and covers auth,
store isolation, forged writes, the login throttle, and 100 concurrent writes
across all 20 stores.

```bash
npm run dev
BASE_URL=http://127.0.0.1:3000 python3 test_app.py
```
