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

  return leads
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
