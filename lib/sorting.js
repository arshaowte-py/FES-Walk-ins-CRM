/**
 * Lead ordering — shared by the server (initial render) and the client (the
 * sort dropdown), so both agree on what "latest first" means.
 *
 * This file deliberately has no imports. The board is a client component, and
 * pulling sorting in from lib/data.js would drag googleapis and the 2MB bundled
 * snapshot into the browser bundle with it.
 *
 * About a third of the real export (1,552 of 4,625 rows) has no unit_price, and
 * a handful have no visit_date. Those rows sink to the bottom of *both*
 * directions rather than pretending to be ₹0 or 1970 — a lead with no recorded
 * price is unknown, not cheap, and it should never head up a "lowest value"
 * list.
 */

export const SORTS = [
  { key: "recent", label: "Latest visit first" },
  { key: "oldest", label: "Oldest visit first" },
  { key: "value_high", label: "Highest value first" },
  { key: "value_low", label: "Lowest value first" },
  { key: "updated", label: "Recently worked" },
];

export const DEFAULT_SORT = "recent";

/** Numeric price, or null when nothing usable was recorded. */
export function priceOf(lead) {
  const raw = String(lead?.unit_price ?? "").replace(/[^0-9.]/g, "");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Sortable timestamp for a visit, or null. Dates are ISO (YYYY-MM-DD). */
export function visitTimeOf(lead) {
  const raw = String(lead?.visit_date ?? "").trim();
  if (!raw) return null;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : null;
}

function updatedTimeOf(lead) {
  const raw = String(lead?.updated_at ?? "").trim();
  if (!raw) return null;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Compare two nullable numbers so that nulls always lose, whichever way the
 * comparison is pointing. `dir` is -1 for descending, 1 for ascending.
 */
function nullsLast(a, b, dir) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (a === b) return 0;
  return a < b ? -dir : dir;
}

const COMPARATORS = {
  // Within a single day, lead an expensive chair over a cushion.
  recent: (a, b) =>
    nullsLast(visitTimeOf(a), visitTimeOf(b), -1) ||
    nullsLast(priceOf(a), priceOf(b), -1),

  oldest: (a, b) =>
    nullsLast(visitTimeOf(a), visitTimeOf(b), 1) ||
    nullsLast(priceOf(a), priceOf(b), -1),

  // Ties on price fall back to recency, so the fresher of two ₹14,999 chairs
  // is the one to call first.
  value_high: (a, b) =>
    nullsLast(priceOf(a), priceOf(b), -1) ||
    nullsLast(visitTimeOf(a), visitTimeOf(b), -1),

  value_low: (a, b) =>
    nullsLast(priceOf(a), priceOf(b), 1) ||
    nullsLast(visitTimeOf(a), visitTimeOf(b), -1),

  updated: (a, b) =>
    nullsLast(updatedTimeOf(a), updatedTimeOf(b), -1) ||
    nullsLast(visitTimeOf(a), visitTimeOf(b), -1),
};

/**
 * Returns a new array; never mutates the input. Falls back to the default sort
 * for an unrecognised key so a stale bookmark can't produce arbitrary order.
 */
export function sortLeads(leads, sortKey = DEFAULT_SORT) {
  const cmp = COMPARATORS[sortKey] || COMPARATORS[DEFAULT_SORT];
  // lead_id breaks remaining ties so the order is stable across reloads
  // instead of drifting between two equally-ranked rows.
  return [...(leads || [])].sort(
    (a, b) => cmp(a, b) || String(a?.lead_id).localeCompare(String(b?.lead_id))
  );
}
