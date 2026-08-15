/**
 * Lead ordering, shared by the server render and the client board.
 *
 * This file deliberately has no imports. lib/data.js pulls in googleapis and
 * the bundled leads snapshot, so a client component can't import from there
 * without dragging both into the browser bundle — it imports this instead.
 */

/**
 * How a store can order its list. `recent` is the default everywhere — the
 * newest walk-in is the one most likely to still remember the visit.
 */
export const SORTS = [
  { key: "recent", label: "Latest visit first" },
  { key: "oldest", label: "Oldest visit first" },
  { key: "value_high", label: "Highest value first" },
  { key: "value_low", label: "Lowest value first" },
  { key: "worked", label: "Recently worked" },
];

export const DEFAULT_SORT = "recent";

export function isSort(key) {
  return SORTS.some((s) => s.key === key);
}

/** Epoch ms, or null when the date is missing or unparseable. */
function timeOf(value) {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

/** Rupees, or null when no price was recorded. Zero is a real price, not null. */
function priceOf(lead) {
  if (lead.unit_price === "" || lead.unit_price === null || lead.unit_price === undefined) {
    return null;
  }
  const n = Number(lead.unit_price);
  return Number.isFinite(n) ? n : null;
}

/** Rows with no value for the active key sort to the bottom, both directions. */
function compare(a, b, dir) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (a === b) return 0;
  return a < b ? -dir : dir;
}

/**
 * Returns a new array — callers hold onto the unsorted list and re-sort it as
 * the store person switches order, so mutating in place would corrupt it.
 *
 * Every comparator falls through to a second key and finally to lead_id, so the
 * order is total: the same leads always come back in the same sequence rather
 * than shuffling between renders.
 */
export function sortLeads(leads, sort = DEFAULT_SORT) {
  const key = isSort(sort) ? sort : DEFAULT_SORT;

  return [...leads].sort((x, y) => {
    let result = 0;

    switch (key) {
      case "oldest":
        result = compare(timeOf(x.visit_date), timeOf(y.visit_date), 1);
        if (result === 0) result = compare(priceOf(x), priceOf(y), -1);
        break;
      case "value_high":
        result = compare(priceOf(x), priceOf(y), -1);
        if (result === 0) result = compare(timeOf(x.visit_date), timeOf(y.visit_date), -1);
        break;
      case "value_low":
        result = compare(priceOf(x), priceOf(y), 1);
        if (result === 0) result = compare(timeOf(x.visit_date), timeOf(y.visit_date), -1);
        break;
      case "worked":
        // Never-touched leads have no updated_at, so they fall to the bottom.
        result = compare(timeOf(x.updated_at), timeOf(y.updated_at), -1);
        if (result === 0) result = compare(timeOf(x.visit_date), timeOf(y.visit_date), -1);
        break;
      case "recent":
      default:
        result = compare(timeOf(x.visit_date), timeOf(y.visit_date), -1);
        if (result === 0) result = compare(priceOf(x), priceOf(y), -1);
        break;
    }

    return result === 0 ? compare(x.lead_id, y.lead_id, 1) : result;
  });
}
