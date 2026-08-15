"use client";

import { useState } from "react";
import { priceOf } from "../lib/sorting";

const STATUSES = [
  "New",
  "Interested",
  "Callback Later",
  "Not Reachable",
  "Not Interested",
  "Converted",
];

function waLink(phone, name, product) {
  const digits = String(phone || "").replace(/[^0-9]/g, "");
  const first = (name || "there").split(" ")[0];
  const item = product ? ` on the ${product}` : "";
  const msg = `Hi ${first}, this is Frido. You visited our store recently — our Freedom Sale is now live and prices are lower${item}. Would you like me to hold one for you?`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(msg)}`;
}

function prettyDate(d) {
  if (!d) return "";
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function LeadCard({ lead, caller, onUpdate }) {
  const [status, setStatus] = useState(lead.status);
  const [notes, setNotes] = useState(lead.notes);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");

  const dirty = status !== lead.status || notes !== lead.notes;
  // Same parser the sorting uses, so the badge and "highest value first" can
  // never disagree about what a lead is worth.
  const price = priceOf(lead);

  async function save(nextStatus = status, nextNotes = notes) {
    setSaving(true);
    setErr("");
    try {
      const res = await fetch("/api/lead-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: lead.lead_id,
          status: nextStatus,
          notes: nextNotes,
          updatedBy: caller,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        onUpdate(lead.lead_id, {
          status: nextStatus,
          notes: nextNotes,
          updated_by: caller,
          updated_at: data.update.updated_at,
        });
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } else {
        setErr(data.error || "Could not save");
      }
    } catch {
      setErr("Could not save — check your connection");
    }
    setSaving(false);
  }

  function onStatusChange(v) {
    setStatus(v);
    save(v, notes); // status changes save immediately; notes need the button
  }

  return (
    <article className={`lead ${lead.priority === "Hot" ? "hot" : ""}`}>
      <div className="lead-top">
        <div className="lead-name">
          {lead.customer_name || "No name recorded"}
          <small>{lead.phone}</small>
        </div>
        <div className="lead-right">
          {/* A third of the export has no recorded price. Show nothing rather
              than ₹0, which would read as a worthless lead. */}
          {price !== null && (
            <span className="lead-amount">₹{price.toLocaleString("en-IN")}</span>
          )}
          <span className={`pill ${lead.priority}`}>{lead.priority}</span>
        </div>
      </div>

      <div className="lead-meta">
        {lead.product && (
          <div>
            Interested in <b>{lead.product}</b>
          </div>
        )}
        <div>
          Visited {prettyDate(lead.visit_date)}
          {lead.zoho_stage ? ` · marked "${lead.zoho_stage}"` : ""}
        </div>
      </div>

      {lead.lost_reason && <div className="reason">Why they didn't buy: {lead.lost_reason}</div>}
      {lead.remarks && <div className="remarks">“{lead.remarks}”</div>}

      <div className="actions">
        <a className="call" href={`tel:${lead.phone}`}>
          Call
        </a>
        <a
          className="wa"
          href={waLink(lead.phone, lead.customer_name, lead.product)}
          target="_blank"
          rel="noreferrer"
        >
          WhatsApp
        </a>
        <select
          className="status-select"
          value={status}
          onChange={(e) => onStatusChange(e.target.value)}
          disabled={saving}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {saved && <span className="saved">Saved</span>}
        {err && <span className="error" style={{ margin: 0 }}>{err}</span>}
      </div>

      <div className="note-row">
        <input
          className="note-input"
          placeholder="Add a note about the call…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && dirty) save();
          }}
        />
        <button className="save" onClick={() => save()} disabled={!dirty || saving}>
          {saving ? "…" : "Save"}
        </button>
      </div>

      {lead.updated_at && (
        <div className="updated">
          Last updated {prettyDate(lead.updated_at)}
          {lead.updated_by ? ` by ${lead.updated_by}` : ""}
        </div>
      )}
    </article>
  );
}
