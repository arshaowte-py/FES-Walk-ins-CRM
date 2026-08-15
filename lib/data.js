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
import { sortLeads, DEFAULT_SORT } from "./sorting";

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

export { SORTS, DEFAULT_SORT, sortLeads } from "./sorting";

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
 *
 * Comes back sorted (newest walk-in first by default) so the server-rendered
 * first paint is already in the right order — the client re-sorts from there.
 */
export async function getLeadsForStore(storeId, sort = DEFAULT_SORT) {
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

  return sortLeads(scoped, sort);
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

// --- head office view --------------------------------------------------------

/** A store with no logged call in this long is treated as not working. */
export const SILENT_AFTER_HOURS = 48;

function rupees(lead) {
  const n = Number(lead.unit_price);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Every store at once, for the admin dashboard.
 *
 * This is the one accessor that deliberately crosses store boundaries, so it is
 * only ever called from a route that has already checked isAdmin(). It takes no
 * store id and does no filtering — there is nothing here a store can call.
 */
export async function getAdminOverview(now = Date.now()) {
  const [leads, stores, updates] = await Promise.all([
    allLeads(),
    allStores(),
    allUpdates(),
  ]);

  // Newest update per lead decides its current status, exactly as the store view
  // computes it — so the two never disagree.
  const latest = latestByLead(updates);

  const blank = () => ({
    total: 0,
    hot: 0,
    warm: 0,
    cold: 0,
    worked: 0,
    untouched: 0,
    converted: 0,
    convertedValue: 0,
    hotUntouched: 0,
    hotUntouchedValue: 0,
    pipelineValue: 0,
    byStatus: {},
  });

  const acc = new Map();
  for (const s of stores) acc.set(s.store_id, blank());

  for (const l of leads) {
    // A lead whose store was deleted from the Stores tab still needs counting
    // somewhere, or the totals silently stop adding up.
    if (!acc.has(l.store_id)) acc.set(l.store_id, blank());
    const a = acc.get(l.store_id);
    const status = latest.get(l.lead_id)?.status || "New";
    const value = rupees(l);

    a.total += 1;
    a.pipelineValue += value;
    a.byStatus[status] = (a.byStatus[status] || 0) + 1;

    if (l.priority === "Hot") a.hot += 1;
    else if (l.priority === "Warm") a.warm += 1;
    else if (l.priority === "Cold") a.cold += 1;

    if (status === "New") {
      a.untouched += 1;
      // The money still sitting on the table: hot leads nobody has called.
      if (l.priority === "Hot") {
        a.hotUntouched += 1;
        a.hotUntouchedValue += value;
      }
    } else {
      a.worked += 1;
    }

    if (status === "Converted") {
      a.converted += 1;
      a.convertedValue += value;
    }
  }

  // Call activity, from the append-only log rather than the lead rows.
  const activity = new Map();
  const staff = new Map();
  for (const u of updates) {
    if (!activity.has(u.store_id)) {
      activity.set(u.store_id, { calls: 0, lastAt: "", people: new Set() });
    }
    const act = activity.get(u.store_id);
    act.calls += 1;
    if (String(u.updated_at) > act.lastAt) act.lastAt = String(u.updated_at);

    const who = String(u.updated_by || "").trim();
    if (who) {
      act.people.add(who);
      if (!staff.has(who)) staff.set(who, { name: who, calls: 0, converted: 0, stores: new Set() });
      const p = staff.get(who);
      p.calls += 1;
      p.stores.add(u.store_id);
      if (u.status === "Converted") p.converted += 1;
    }
  }

  const silentCutoff = now - SILENT_AFTER_HOURS * 60 * 60 * 1000;
  const known = new Map(stores.map((s) => [s.store_id, s]));

  const rows = [...acc.entries()].map(([storeId, a]) => {
    const store = known.get(storeId);
    const act = activity.get(storeId) || { calls: 0, lastAt: "", people: new Set() };
    const lastAtMs = act.lastAt ? Date.parse(act.lastAt) : NaN;
    const active = store ? String(store.active).toUpperCase() !== "FALSE" : false;

    return {
      store_id: storeId,
      store_name: store?.store_name || storeId,
      active,
      orphaned: !store,
      ...a,
      calls: act.calls,
      staffCount: act.people.size,
      lastActivityAt: act.lastAt || "",
      // Percentages are of the store's own book, so a small store isn't
      // penalised for having fewer leads than a big one.
      coverage: a.total ? a.worked / a.total : 0,
      conversionRate: a.total ? a.converted / a.total : 0,
      // Never started at all reads differently from started then stopped.
      neverStarted: a.worked === 0,
      silent: !Number.isFinite(lastAtMs) || lastAtMs < silentCutoff,
    };
  });

  const working = rows.filter((r) => r.active && !r.orphaned);
  const byVolume = [...working].sort((a, b) => a.total - b.total);
  const byHot = [...working].sort((a, b) => b.hot - a.hot);

  const totals = rows.reduce(
    (t, r) => ({
      stores: t.stores + 1,
      leads: t.leads + r.total,
      hot: t.hot + r.hot,
      worked: t.worked + r.worked,
      untouched: t.untouched + r.untouched,
      converted: t.converted + r.converted,
      convertedValue: t.convertedValue + r.convertedValue,
      hotUntouchedValue: t.hotUntouchedValue + r.hotUntouchedValue,
      pipelineValue: t.pipelineValue + r.pipelineValue,
      calls: t.calls + r.calls,
    }),
    {
      stores: 0, leads: 0, hot: 0, worked: 0, untouched: 0,
      converted: 0, convertedValue: 0, hotUntouchedValue: 0,
      pipelineValue: 0, calls: 0,
    }
  );

  return {
    generatedAt: new Date(now).toISOString(),
    silentAfterHours: SILENT_AFTER_HOURS,
    totals: {
      ...totals,
      coverage: totals.leads ? totals.worked / totals.leads : 0,
      conversionRate: totals.leads ? totals.converted / totals.leads : 0,
    },
    stores: rows,
    alerts: {
      // "Not working" is the headline the admin actually asked for, so it is
      // split three ways rather than lumped into one vague red flag.
      neverStarted: working.filter((r) => r.neverStarted),
      silent: working.filter((r) => r.silent && !r.neverStarted),
      disabled: rows.filter((r) => !r.active && !r.orphaned),
      orphaned: rows.filter((r) => r.orphaned),
      lowestVolume: byVolume.slice(0, 5),
      highestHot: byHot.slice(0, 5),
    },
    staff: [...staff.values()]
      .map((p) => ({ ...p, stores: p.stores.size }))
      .sort((a, b) => b.calls - a.calls)
      .slice(0, 10),
  };
}
