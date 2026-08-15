import { google } from "googleapis";

/**
 * Google Sheets data layer.
 *
 * Two things here matter for running this with 20 stores at once:
 *
 * 1. READS ARE SHARED AND CACHED.
 *    We pull the whole Leads tab once and slice it per store in memory. So 20
 *    people refreshing at the same second cost one API call, not twenty. An
 *    in-flight promise is reused, so a burst of simultaneous misses also
 *    collapses into a single fetch.
 *
 * 2. WRITES ARE APPEND-ONLY.
 *    We never update a lead row in place. Every status change appends a row to
 *    the Updates tab, and current status is "the newest update for that lead".
 *    Sheets' append is atomic, so two stores writing at the same moment cannot
 *    overwrite each other, and nothing breaks if you re-sort or re-import the
 *    Leads tab underneath it.
 */

export const LEADS_TAB = "Leads";
export const STORES_TAB = "Stores";
export const UPDATES_TAB = "Updates";

/**
 * Read at call time, never at module scope.
 *
 * This used to be `const SHEET_ID = process.env.GOOGLE_SHEET_ID` up here, and
 * that quietly broke the Sheet integration on Vercel. Environment variables
 * marked "Sensitive" there are runtime-only — deliberately withheld from the
 * build — and Next resolves module-scope process.env reads at build time. So
 * SHEET_ID froze as undefined, sheetsConfigured() stayed false no matter what
 * was configured, and the app served the bundled snapshot forever while
 * insisting the Sheet "isn't connected yet".
 *
 * Reading inside a function costs nothing and can't go stale.
 */
function sheetId() {
  return process.env.GOOGLE_SHEET_ID;
}

export function sheetsConfigured() {
  return Boolean(
    sheetId() &&
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
      process.env.GOOGLE_PRIVATE_KEY
  );
}

let _client = null;
function client() {
  if (_client) return _client;
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  _client = google.sheets({ version: "v4", auth });
  return _client;
}

// --- caching -----------------------------------------------------------------

const cache = new Map(); // tab -> { rows, at }
const inflight = new Map(); // tab -> Promise

const TTL = {
  [LEADS_TAB]: 5 * 60 * 1000, // leads only change when you re-import
  [STORES_TAB]: 5 * 60 * 1000,
  [UPDATES_TAB]: 15 * 1000, // needs to feel live to the person typing
};

export function invalidate(tab) {
  cache.delete(tab);
}

async function withRetry(fn, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const code = err?.code || err?.response?.status;
      // 429 = rate limited, 5xx = transient. Anything else won't fix itself.
      if (code !== 429 && !(code >= 500 && code < 600)) throw err;
      await new Promise((r) => setTimeout(r, 300 * Math.pow(2, i) + Math.random() * 200));
    }
  }
  throw lastErr;
}

/** Rows as objects keyed by the header row. */
async function readTab(tab) {
  const now = Date.now();
  const hit = cache.get(tab);
  if (hit && now - hit.at < (TTL[tab] ?? 60000)) return hit.rows;

  if (inflight.has(tab)) return inflight.get(tab);

  const p = (async () => {
    try {
      const res = await withRetry(() =>
        client().spreadsheets.values.get({
          spreadsheetId: sheetId(),
          range: `${tab}!A:Z`,
        })
      );
      const values = res.data.values || [];
      if (values.length === 0) return [];
      const [header, ...body] = values;
      const rows = body.map((r) => {
        const o = {};
        header.forEach((h, i) => {
          o[h] = r[i] ?? "";
        });
        return o;
      });
      cache.set(tab, { rows, at: Date.now() });
      return rows;
    } catch (err) {
      // Serving slightly stale data beats showing an error to someone
      // mid-call with a customer.
      if (hit) {
        console.error(`Sheets read failed for ${tab}, serving stale:`, err.message);
        return hit.rows;
      }
      throw err;
    } finally {
      inflight.delete(tab);
    }
  })();

  inflight.set(tab, p);
  return p;
}

export async function readLeads() {
  return readTab(LEADS_TAB);
}

export async function readStores() {
  return readTab(STORES_TAB);
}

export async function readUpdates() {
  return readTab(UPDATES_TAB);
}

/** Append-only. Safe to call concurrently from any number of stores. */
export async function appendUpdate(row) {
  await withRetry(() =>
    client().spreadsheets.values.append({
      spreadsheetId: sheetId(),
      range: `${UPDATES_TAB}!A:G`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [
          [
            row.update_id,
            row.lead_id,
            row.store_id,
            row.status,
            row.notes,
            row.updated_by,
            row.updated_at,
          ],
        ],
      },
    })
  );
  invalidate(UPDATES_TAB);
}
