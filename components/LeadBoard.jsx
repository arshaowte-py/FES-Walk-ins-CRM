"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import LeadCard from "./LeadCard";

const STATUSES = [
  "New",
  "Interested",
  "Callback Later",
  "Not Reachable",
  "Not Interested",
  "Converted",
];

const PAGE = 40;

export default function LeadBoard({ storeName, leads, summary, previewMode }) {
  const [rows, setRows] = useState(leads);
  const [tab, setTab] = useState("Hot");
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [limit, setLimit] = useState(PAGE);
  const [caller, setCaller] = useState("");
  const router = useRouter();

  // Who's making the calls — written onto every update so you can see which
  // staff member worked which lead.
  useEffect(() => {
    setCaller(window.localStorage.getItem("frido_caller") || "");
  }, []);

  function saveCaller(v) {
    setCaller(v);
    window.localStorage.setItem("frido_caller", v);
  }

  const counts = useMemo(() => {
    const c = { All: rows.length, Hot: 0, Warm: 0, Cold: 0, Converted: 0, Pending: 0 };
    for (const l of rows) {
      if (c[l.priority] !== undefined) c[l.priority] += 1;
      if (l.status === "New") c.Pending += 1;
    }
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((l) => {
      if (tab === "Pending" && l.status !== "New") return false;
      if (tab !== "All" && tab !== "Pending" && l.priority !== tab) return false;
      if (statusFilter !== "all" && l.status !== statusFilter) return false;
      if (!needle) return true;
      return (
        l.customer_name.toLowerCase().includes(needle) ||
        l.phone.includes(needle) ||
        (l.product || "").toLowerCase().includes(needle)
      );
    });
  }, [rows, tab, q, statusFilter]);

  useEffect(() => setLimit(PAGE), [tab, q, statusFilter]);

  function applyUpdate(leadId, patch) {
    setRows((prev) =>
      prev.map((l) => (l.lead_id === leadId ? { ...l, ...patch } : l))
    );
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    router.replace("/");
    router.refresh();
  }

  const worked = rows.filter((l) => l.status !== "New").length;

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="store-name">
            {storeName}
            <small>{rows.length} leads assigned to you</small>
          </div>
          <input
            className="link-btn"
            style={{ width: 118 }}
            placeholder="Your name"
            value={caller}
            onChange={(e) => saveCaller(e.target.value)}
            aria-label="Your name"
          />
          <button className="link-btn" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>

      <main className="page">
        {previewMode && (
          <div className="warn">
            <b>Preview mode.</b> The Google Sheet isn't connected yet, so status
            changes will disappear when the server restarts. Add the Sheet
            environment variables to make them stick.
          </div>
        )}

        <div className="banner">
          <h2>Freedom Sale is live — prices are down</h2>
          <p>
            These are people who walked into your store and didn't buy. Start
            with <b>Hot</b> — those {counts.Hot} said price was the reason, so
            the sale answers their exact objection.
          </p>
        </div>

        <div className="stats">
          <div className="stat">
            <b>{counts.Hot}</b>
            <span>Hot</span>
          </div>
          <div className="stat">
            <b>{counts.Warm}</b>
            <span>Warm</span>
          </div>
          <div className="stat">
            <b>{worked}</b>
            <span>Worked</span>
          </div>
          <div className="stat">
            <b>{rows.filter((l) => l.status === "Converted").length}</b>
            <span>Converted</span>
          </div>
        </div>

        <div className="tabs">
          {["Hot", "Warm", "Cold", "Pending", "Converted", "All"].map((t) => (
            <button
              key={t}
              className={`tab ${tab === t ? "on" : ""} ${t === "Hot" ? "hot" : ""}`}
              onClick={() => setTab(t)}
            >
              {t === "Pending" ? "Not called yet" : t}
              {counts[t] !== undefined ? ` (${counts[t]})` : ""}
            </button>
          ))}
        </div>

        <div className="controls">
          <input
            className="search"
            placeholder="Search name, phone or product…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select
            className="select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">Any call status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {filtered.length === 0 ? (
          <div className="empty">
            Nothing here. Try another tab or clear the search.
          </div>
        ) : (
          <>
            <div className="list">
              {filtered.slice(0, limit).map((l) => (
                <LeadCard
                  key={l.lead_id}
                  lead={l}
                  caller={caller}
                  onUpdate={applyUpdate}
                />
              ))}
            </div>
            {filtered.length > limit && (
              <button className="more" onClick={() => setLimit((n) => n + PAGE)}>
                Show more ({filtered.length - limit} left)
              </button>
            )}
          </>
        )}
      </main>
    </>
  );
}
