import crypto from "crypto";
import {
  sheetsConfigured,
  readLeads,
  readStores,
  readUpdates,
  appendUpdate,
} from "./sheets";
import seedLeads from "../data/leads.json";
import seedStores from "../data/stores.json";
import { sortLeads, DEFAULT_SORT, priceOf } from "./sorting";

/**
 * Everything the app asks for goes through here, so there is exactly one place
 * that decides "Sheet or bundled snapshot" and exactly one place that enforces
 * store scoping.
 */

export const STATUSES = [
  "New",
  "Interested",
  "Callback Later",
  "Not Reachable",
  "Not Interested",
  "Converted",
];

export const PRIORITIES = ["Hot", "Warm", "Cold", "Converted"];

// Fallback store for updates when the Sheet isn't wired up yet. Resets on every
// cold start — preview only, never rely on it in production.
const memoryUpdates = [];

async function allLeads() {
  return sheetsConfigured() ? readLeads() : seedLeads;
}

async function allStores() {
  return sheetsConfigured() ? readStores() : seedStores;
}

async function allUpdates() {
  return sheetsConfigured() ? readUpdates() : memoryUpdates;
}

/** Newest update per lead wins. This is what makes append-only work. */
function latestByLead(updates) {
  const map = new Map();
  for (const u of updates) {
    const prev = map.get(u.lead_id);
    if (!prev || String(u.updated_at) > String(prev.updated_at)) {
      map.set(u.lead_id, u);
    }
  }
  return map;
}

export async function getStoreByCode(code) {
  const stores = await allStores();
  const clean = String(code || "").trim();
  if (!/^\d{4}$/.test(clean)) return null;
  return (
    stores.find(
      (s) =>
        String(s.access_code).trim() === clean &&
        String(s.active).toUpperCase() !== "FALSE"
    ) || null
  );
}

export async function getStore(storeId) {
  const stores = await allStores();
  return stores.find((s) => s.store_id === storeId) || null;
}

/**
 * The only lead accessor. It takes a storeId and filters by it — there is no
 * code path that returns another store's leads, so a tampered request can't
 * reach them.
 */
export async function getLeadsForStore(storeId) {
  if (!storeId) return [];
  const [leads, updates] = await Promise.all([allLeads(), allUpdates()]);
  const latest = latestByLead(updates.filter((u) => u.store_id === storeId));

  const scoped = leads
    .filter((l) => l.store_id === storeId)
    .map((l) => {
      const u = latest.get(l.lead_id);
      return {
        ...l,
        status: u?.status || "New",
        notes: u?.notes || "",
        updated_by: u?.updated_by || "",
        updated_at: u?.updated_at || "",
      };
    });

  // Sorted here so the very first server render is already newest-first —
  // the board re-sorts on the client when someone changes the dropdown.
  return sortLeads(scoped, DEFAULT_SORT);
}

export async function saveUpdate({ storeId, leadId, status, notes, updatedBy }) {
  // Re-check the lead really belongs to this store before writing.
  const leads = await allLeads();
  const lead = leads.find((l) => l.lead_id === leadId && l.store_id === storeId);
  if (!lead) return { ok: false, error: "Lead not found for this store" };

  if (!STATUSES.includes(status)) {
    return { ok: false, error: "Unknown status" };
  }

  const row = {
    update_id: crypto.randomUUID(),
    lead_id: leadId,
    store_id: storeId,
    status,
    notes: String(notes || "").slice(0, 1000),
    updated_by: String(updatedBy || "").slice(0, 60),
    updated_at: new Date().toISOString(),
  };

  if (sheetsConfigured()) {
    await appendUpdate(row);
  } else {
    memoryUpdates.push(row);
  }

  return { ok: true, update: row };
}

// --- admin / cross-store -----------------------------------------------------

/** A store is "not working" if nobody has logged anything in this long. */
const SILENT_HOURS = 48;
/** Below this share of leads touched, a store is coasting. */
const LOW_COVERAGE = 0.25;
/** Ignore tiny stores when ranking conversion — 3 leads out of 4 isn't a trend. */
const RANKING_MIN_LEADS = 50;

function hoursSince(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / 36e5;
}

/**
 * Every store's numbers in one pass, plus the flags an area manager actually
 * acts on. Aggregate only — this never returns customer rows, so the admin
 * view can't become a back door to 4,600 phone numbers.
 *
 * Callers MUST check isAdmin() first. This is the one function in the file
 * that is not scoped to a single store.
 */
export async function getAdminOverview() {
  const [leads, stores, updates] = await Promise.all([
    allLeads(),
    allStores(),
    allUpdates(),
  ]);

  const latest = latestByLead(updates);

  // Bucket leads by store once rather than filtering per store.
  const byStore = new Map();
  for (const l of leads) {
    if (!byStore.has(l.store_id)) byStore.set(l.store_id, []);
    byStore.get(l.store_id).push(l);
  }

  // Most recent activity and update count per store, from the Updates log.
  const activity = new Map();
  for (const u of updates) {
    const cur = activity.get(u.store_id) || { last: "", count: 0 };
    cur.count += 1;
    if (String(u.updated_at) > String(cur.last)) cur.last = u.updated_at;
    activity.set(u.store_id, cur);
  }

  const rows = stores.map((s) => {
    const mine = byStore.get(s.store_id) || [];
    const act = activity.get(s.store_id) || { last: "", count: 0 };

    let worked = 0;
    let converted = 0;
    let hot = 0;
    let hotUntouched = 0;
    let revenueWon = 0;
    let revenueAtRisk = 0;

    for (const l of mine) {
      const status = latest.get(l.lead_id)?.status || "New";
      const price = priceOf(l) || 0;
      const isHot = l.priority === "Hot";

      if (status !== "New") worked += 1;
      if (status === "Converted") {
        converted += 1;
        revenueWon += price;
      }
      if (isHot) {
        hot += 1;
        if (status === "New") {
          hotUntouched += 1;
          // Hot means they walked over price. The sale answers that, so an
          // uncalled hot lead is the most expensive kind of inaction.
          revenueAtRisk += price;
        }
      }
    }

    const total = mine.length;
    const idleHours = hoursSince(act.last);

    return {
      store_id: s.store_id,
      store_name: s.store_name,
      active: String(s.active).toUpperCase() !== "FALSE",
      total,
      worked,
      untouched: total - worked,
      coverage: total ? worked / total : 0,
      hot,
      hotUntouched,
      converted,
      conversionRate: total ? converted / total : 0,
      revenueWon,
      revenueAtRisk,
      updatesLogged: act.count,
      lastActivity: act.last || "",
      idleHours,
    };
  });

  // --- flags ---------------------------------------------------------------
  // Ranked flags are relative to the other stores, so they stay meaningful
  // whatever the absolute numbers look like on the day.
  const ranked = rows.filter((r) => r.total >= RANKING_MIN_LEADS);

  const lowestCapture = [...rows]
    .filter((r) => r.active)
    .sort((a, b) => a.total - b.total)
    .slice(0, 5)
    .map((r) => r.store_id);

  const highestHot = [...rows]
    .sort((a, b) => b.hot - a.hot)
    .filter((r) => r.hot > 0)
    .slice(0, 5)
    .map((r) => r.store_id);

  const bestConverter = [...ranked].sort(
    (a, b) => b.conversionRate - a.conversionRate
  )[0]?.store_id;

  for (const r of rows) {
    r.flags = [];

    // "Not working" — nothing logged at all, or nothing for two days.
    if (r.idleHours === null) {
      r.flags.push({
        key: "silent",
        level: "bad",
        label: "Not started",
        detail: "No calls logged yet",
      });
    } else if (r.idleHours > SILENT_HOURS) {
      r.flags.push({
        key: "silent",
        level: "bad",
        label: "Gone quiet",
        detail: `Nothing logged in ${Math.floor(r.idleHours)}h`,
      });
    }

    if (r.hotUntouched > 0) {
      r.flags.push({
        key: "hot-untouched",
        level: "bad",
        label: `${r.hotUntouched} hot uncalled`,
        detail: "Walked over price — the sale answers that objection",
      });
    }

    if (r.total > 0 && r.coverage < LOW_COVERAGE && r.idleHours !== null) {
      r.flags.push({
        key: "low-coverage",
        level: "warn",
        label: `Only ${Math.round(r.coverage * 100)}% worked`,
        detail: `${r.untouched} leads never touched`,
      });
    }

    if (lowestCapture.includes(r.store_id)) {
      r.flags.push({
        key: "low-capture",
        level: "warn",
        label: "Low capture",
        detail: `Only ${r.total} walk-ins recorded — a capture problem, not a calling one`,
      });
    }

    if (highestHot.includes(r.store_id)) {
      r.flags.push({
        key: "high-hot",
        level: "info",
        label: `${r.hot} hot leads`,
        detail: "Biggest pool of price-sensitive walk-aways",
      });
    }

    if (r.store_id === bestConverter && r.converted > 0) {
      r.flags.push({
        key: "top-converter",
        level: "good",
        label: "Best conversion",
        detail: `${Math.round(r.conversionRate * 100)}% of leads converted`,
      });
    }

    if (!r.active) {
      r.flags.push({
        key: "disabled",
        level: "info",
        label: "Access off",
        detail: "Set to FALSE in the Stores tab",
      });
    }
  }

  // Who is actually making the calls, across all stores.
  const staff = new Map();
  for (const u of updates) {
    const name = String(u.updated_by || "").trim();
    if (!name) continue;
    const cur = staff.get(name) || { name, updates: 0, stores: new Set(), last: "" };
    cur.updates += 1;
    cur.stores.add(u.store_id);
    if (String(u.updated_at) > String(cur.last)) cur.last = u.updated_at;
    staff.set(name, cur);
  }

  const totals = rows.reduce(
    (t, r) => ({
      stores: t.stores + 1,
      leads: t.leads + r.total,
      worked: t.worked + r.worked,
      converted: t.converted + r.converted,
      hot: t.hot + r.hot,
      hotUntouched: t.hotUntouched + r.hotUntouched,
      revenueWon: t.revenueWon + r.revenueWon,
      revenueAtRisk: t.revenueAtRisk + r.revenueAtRisk,
      updatesLogged: t.updatesLogged + r.updatesLogged,
    }),
    {
      stores: 0,
      leads: 0,
      worked: 0,
      converted: 0,
      hot: 0,
      hotUntouched: 0,
      revenueWon: 0,
      revenueAtRisk: 0,
      updatesLogged: 0,
    }
  );

  totals.coverage = totals.leads ? totals.worked / totals.leads : 0;
  totals.conversionRate = totals.leads ? totals.converted / totals.leads : 0;
  totals.silentStores = rows.filter((r) =>
    r.flags.some((f) => f.key === "silent")
  ).length;

  return {
    generatedAt: new Date().toISOString(),
    totals,
    stores: rows,
    staff: [...staff.values()]
      .map((s) => ({ ...s, stores: s.stores.size }))
      .sort((a, b) => b.updates - a.updates)
      .slice(0, 15),
    thresholds: { silentHours: SILENT_HOURS, lowCoverage: LOW_COVERAGE },
  };
}

export function summarise(leads) {
  const byStatus = {};
  for (const s of STATUSES) byStatus[s] = 0;
  const byPriority = { Hot: 0, Warm: 0, Cold: 0, Converted: 0 };

  for (const l of leads) {
    byStatus[l.status] = (byStatus[l.status] || 0) + 1;
    if (byPriority[l.priority] !== undefined) byPriority[l.priority] += 1;
  }

  const worked = leads.filter((l) => l.status !== "New").length;
  return {
    total: leads.length,
    worked,
    pending: leads.length - worked,
    converted: byStatus["Converted"] || 0,
    byStatus,
    byPriority,
  };
}
