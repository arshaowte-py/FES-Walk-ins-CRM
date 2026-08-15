"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Rupees, shortened. A store's recovered value is read at a glance, so
 * "₹12.4L" beats "₹1,240,000" — the exact figure is in the Sheet.
 */
function inr(n) {
  const v = Number(n) || 0;
  if (v >= 10000000) return `₹${(v / 10000000).toFixed(1)} Cr`;
  if (v >= 100000) return `₹${(v / 100000).toFixed(1)} L`;
  return `₹${v.toLocaleString("en-IN")}`;
}

function pct(x) {
  return `${Math.round((Number(x) || 0) * 100)}%`;
}

/**
 * Measured against the server's own timestamp, not the browser's clock — the
 * two differ, and using Date.now() here would make the server and client render
 * different text and trip a hydration mismatch.
 */
function ago(iso, nowIso) {
  if (!iso) return "never";
  const then = Date.parse(iso);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(then) || !Number.isFinite(now)) return "—";
  const mins = Math.max(0, Math.round((now - then) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

const COLUMNS = [
  { key: "store_name", label: "Store", align: "left" },
  { key: "total", label: "Leads" },
  { key: "hot", label: "Hot" },
  { key: "worked", label: "Worked" },
  { key: "coverage", label: "Covered", format: pct },
  { key: "converted", label: "Won" },
  { key: "conversionRate", label: "Conv. rate", format: pct },
  { key: "convertedValue", label: "Recovered", format: inr },
  { key: "hotUntouchedValue", label: "Hot untouched", format: inr },
  { key: "calls", label: "Calls" },
];

export default function AdminBoard({ data, previewMode }) {
  const [sortKey, setSortKey] = useState("conversionRate");
  const [asc, setAsc] = useState(false);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const router = useRouter();

  const { totals, alerts, staff, generatedAt, silentAfterHours } = data;

  const rows = useMemo(() => {
    const list = onlyProblems
      ? data.stores.filter((s) => s.neverStarted || s.silent || !s.active)
      : data.stores;

    return [...list].sort((a, b) => {
      const x = a[sortKey];
      const y = b[sortKey];
      const cmp =
        typeof x === "string" ? x.localeCompare(y) : (Number(x) || 0) - (Number(y) || 0);
      return asc ? cmp : -cmp;
    });
  }, [data.stores, sortKey, asc, onlyProblems]);

  function sortBy(key) {
    if (key === sortKey) {
      setAsc((v) => !v);
    } else {
      setSortKey(key);
      // Names read naturally A-Z; every number is more interesting descending.
      setAsc(key === "store_name");
    }
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.replace("/admin");
    router.refresh();
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="store-name">
            Head office
            <small>
              All {totals.stores} stores · as of {ago(generatedAt, generatedAt) === "just now" ? "now" : generatedAt.slice(0, 10)}
            </small>
          </div>
          <button className="link-btn" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>

      <main className="page admin-page">
        {previewMode && (
          <div className="warn">
            <b>Preview mode.</b> The Google Sheet isn't connected, so call
            activity resets whenever the server restarts. Every store will look
            like it hasn't started.
          </div>
        )}

        <div className="stats admin-stats">
          <div className="stat">
            <b>{totals.leads.toLocaleString("en-IN")}</b>
            <span>Total leads</span>
          </div>
          <div className="stat">
            <b>{pct(totals.coverage)}</b>
            <span>Called at least once</span>
          </div>
          <div className="stat">
            <b>{totals.converted.toLocaleString("en-IN")}</b>
            <span>Converted</span>
          </div>
          <div className="stat">
            <b>{inr(totals.convertedValue)}</b>
            <span>Recovered</span>
          </div>
          <div className="stat">
            <b>{inr(totals.hotUntouchedValue)}</b>
            <span>Hot, not yet called</span>
          </div>
        </div>

        {/* The flags, loudest first. */}
        <section className="alerts">
          <AlertCard
            tone="bad"
            title="Not working at all"
            hint="No call logged against a single lead."
            stores={alerts.neverStarted}
            render={(s) => `${s.total} waiting`}
          />
          <AlertCard
            tone="warn"
            title={`Gone quiet (${silentAfterHours}h+)`}
            hint="Started, then stopped."
            stores={alerts.silent}
            render={(s) => `last call ${ago(s.lastActivityAt, generatedAt)}`}
          />
          <AlertCard
            tone="warn"
            title="Smallest lead books"
            hint="Fewest walk-ins captured — worth checking their Zoho entry."
            stores={alerts.lowestVolume}
            render={(s) => `${s.total} leads`}
          />
          <AlertCard
            tone="good"
            title="Most hot leads"
            hint="Biggest price-objection pools — the sale answers these directly."
            stores={alerts.highestHot}
            render={(s) => `${s.hot} hot · ${inr(s.hotUntouchedValue)}`}
          />
          {alerts.disabled.length > 0 && (
            <AlertCard
              tone="off"
              title="Switched off"
              hint="active = FALSE in the Stores tab. They cannot sign in."
              stores={alerts.disabled}
              render={() => "no access"}
            />
          )}
          {alerts.orphaned.length > 0 && (
            <AlertCard
              tone="bad"
              title="Leads with no store"
              hint="These store ids are in the Leads tab but missing from Stores — nobody can see them."
              stores={alerts.orphaned}
              render={(s) => `${s.total} stranded`}
            />
          )}
        </section>

        <div className="controls">
          <button
            className={`tab ${onlyProblems ? "on" : ""}`}
            onClick={() => setOnlyProblems((v) => !v)}
          >
            {onlyProblems ? "Showing problem stores" : "Show problem stores only"}
          </button>
        </div>

        <div className="table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                {COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    className={c.align === "left" ? "left" : ""}
                    onClick={() => sortBy(c.key)}
                    aria-sort={
                      sortKey === c.key ? (asc ? "ascending" : "descending") : "none"
                    }
                  >
                    {c.label}
                    {sortKey === c.key ? (asc ? " ▲" : " ▼") : ""}
                  </th>
                ))}
                <th className="left">Last call</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.store_id} className={s.neverStarted ? "row-bad" : s.silent ? "row-warn" : ""}>
                  {COLUMNS.map((c) => (
                    <td key={c.key} className={c.align === "left" ? "left" : ""}>
                      {c.key === "store_name" ? (
                        <span className="store-cell">
                          {s.store_name}
                          {!s.active && <span className="flag off">off</span>}
                          {s.neverStarted && <span className="flag bad">not started</span>}
                          {!s.neverStarted && s.silent && <span className="flag warn">quiet</span>}
                        </span>
                      ) : c.format ? (
                        c.format(s[c.key])
                      ) : (
                        (s[c.key] ?? 0).toLocaleString("en-IN")
                      )}
                    </td>
                  ))}
                  <td className="left muted">{ago(s.lastActivityAt, generatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <section className="staff">
          <h3>Who's making the calls</h3>
          {staff.length === 0 ? (
            <div className="empty">
              No calls logged yet. Staff names come from the "Your name" box on
              the store dashboard.
            </div>
          ) : (
            <ol className="staff-list">
              {staff.map((p) => (
                <li key={p.name}>
                  <span className="staff-name">{p.name}</span>
                  <span className="muted">
                    {p.calls.toLocaleString("en-IN")} updates · {p.converted} won
                    {p.stores > 1 ? ` · ${p.stores} stores` : ""}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </main>
    </>
  );
}

/**
 * Capped at six. On day one every store is "not working", and an uncapped list
 * pushes the actual table off the screen — the count in the heading is the
 * number that matters, the names are just the first few to chase.
 */
function AlertCard({ tone, title, hint, stores, render, max = 6 }) {
  const shown = stores.slice(0, max);
  const rest = stores.length - shown.length;

  return (
    <div className={`alert ${tone}`}>
      <h4>
        {title} <span className="count">{stores.length}</span>
      </h4>
      <p className="hint">{hint}</p>
      {stores.length === 0 ? (
        <div className="none">None — all good.</div>
      ) : (
        <>
          <ul>
            {shown.map((s) => (
              <li key={s.store_id}>
                <span className="alert-store">{s.store_name}</span>
                <span className="muted alert-value">{render(s)}</span>
              </li>
            ))}
          </ul>
          {rest > 0 && <div className="none">and {rest} more</div>}
        </>
      )}
    </div>
  );
}
