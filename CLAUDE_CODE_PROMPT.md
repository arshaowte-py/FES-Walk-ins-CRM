# Prompts for Claude Code

The app is already built and tested. These are for picking it up and taking it
further.

---

## Ground rules to keep at the top of any session

```
Do not run any git commands. No checkout, add, commit, push, status, restore,
stash or diff — I run all git myself. Tell me when something is ready and I'll
handle the branch and commit.
```

---

## Prompt 1 — Onboarding Claude Code onto this repo

Paste this first in a fresh session, from inside the `frido-leads-crm` folder.

```
This is a Next.js 14 App Router CRM that lets 20 Frido retail stores each see
only their own walk-in leads, gated by a 4-digit code. It's live on Vercel and
backed by a Google Sheet. Read SETUP.md and README.md first, then lib/data.js
and lib/sheets.js before changing anything.

Three constraints that are load-bearing — do not break them:

1. Store scoping happens in exactly one place: getLeadsForStore() in
   lib/data.js. The store id comes only from the signed cookie in
   lib/session.js, never from a request body or query param. Any new endpoint
   must follow that pattern.

2. Writes to the Sheet are append-only, to the Updates tab. Never update a lead
   row in place — 20 stores write concurrently and in-place edits lose data.
   Current status is defined as the newest Updates row for a lead.

3. Reads of the Leads tab are cached and shared across all stores, so 20
   simultaneous users cost one Sheets API call. Don't add per-request reads.

There's a test suite at test_app.py covering auth, store isolation, forged
writes, the login throttle, and 100 concurrent writes. Run it after any change
to lib/ or app/api/:

  npm run dev
  BASE_URL=http://127.0.0.1:3000 python3 test_app.py

Do not run any git commands — I run all git myself.
```

---

## Prompt 2 — The admin view (the most useful next thing)

```
Add an admin dashboard at /admin, behind its own code stored in an ADMIN_CODE
env var (not in the Stores tab).

It should show, across all 20 stores:
- a table of store x status counts, sorted by conversion rate
- how many leads each store has actually worked vs left untouched
- total converted, and the rupee value of converted leads using unit_price
- which staff names are logging the most calls
- stores that have done nothing in the last 48 hours, called out clearly

Read from the Updates tab. Reuse the caching in lib/sheets.js rather than
adding new reads. Keep the visual language of the store dashboard.

Do not run any git commands.
```

---

## Prompt 3 — Re-importing a fresh Zoho export

```
Right now updating leads means running prep_data.py by hand and pasting into
the Sheet. Build a small importer instead:

- an /admin/import page, behind the admin code
- upload a raw Zoho walk-in CSV export
- apply the same cleaning as prep_data.py in this repo: normalise the
  duplicate store spellings via the STORE_ALIASES map, tier leads into
  Hot/Warm/Cold/Converted using the same rules, normalise phone numbers
- show a preview: how many new leads, how many already exist by lead_id, how
  many rows had a store name that didn't match any known store
- on confirm, write only the new leads to the Leads tab, appending

Critical: never touch the Updates tab during an import, and never renumber or
reuse lead_id values — the call history is joined on lead_id.

Do not run any git commands.
```

---

## Prompt 4 — Smaller things worth doing

```
Working through these one at a time, running test_app.py after each:

1. A "Today" view: leads this store touched today, so a manager can see the
   shift's work at a glance.
2. Sort control on the lead list — highest unit_price first, so staff chase the
   ₹69,000 chair before the ₹999 cushion.
3. Optimistic UI on the status dropdown with a rollback if the save fails.
   Right now a slow connection makes it feel laggy.
4. A per-lead "call attempted" counter, so Not Reachable leads can be retried a
   sensible number of times rather than forever.
5. CSV export of this store's leads, for anyone who'd rather work off paper.

Do not run any git commands.
```

---

## Prompt 5 — If you'd rather rebuild it from scratch

Only if you want a different architecture. Otherwise iterate on what exists.

```
Build a Next.js 14 App Router app on Vercel: a per-store lead CRM for 20 retail
stores, backed by a Google Sheet.

Auth: a store enters a 4-digit code. Validate it against a Stores tab, then set
a signed httpOnly cookie holding the store id. Never trust a store id from the
client. Throttle failed logins per IP.

Data: a Leads tab (read-only to the app) with lead_id, store_id, customer_name,
phone, product, unit_price, zoho_stage, lost_reason, priority, visit_date,
remarks. An append-only Updates tab with update_id, lead_id, store_id, status,
notes, updated_by, updated_at. Current status = newest Updates row per lead.
Never edit a lead row in place — 20 stores write at once.

Cache the Leads read globally with a 5 minute TTL and dedupe in-flight requests,
so concurrent users don't multiply Sheets API calls. Serve stale data if Sheets
errors rather than showing a failure.

UI: mobile-first, because store staff use phones. Lead cards with priority
badge, tap-to-call, WhatsApp deep link with a pre-filled sale message, a status
dropdown that saves on change, and a notes field. Filter tabs by priority and
search by name/phone/product.

Do not run any git commands.
```
