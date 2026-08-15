"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

/** Indian money, short enough to fit a table cell. */
function money(n) {
  const v = Number(n) || 0;
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(v >= 1e8 ? 0 : 1)}Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(v >= 1e6 ? 0 : 1)}L`;
  if (v >= 1e3) return `₹${(v / 1e3).toFixed(0)}k`;
  return `₹${v.toLocaleString("en-IN")}`;
}

function pct(n) {
  return `${Math.round((Number(n) || 0) * 100)}%`;
}

function relTime(iso, idleHours) {
  if (!iso) return "never";
  if (idleHours === null || idleHours === undefined) return "—";
  if (idleHours < 1) return "just now";
  if (idleHours < 24) return `${Math.floor(idleHours)}h ago`;
  return `${Math.floor(idleHours / 24)}d ago`;
}

const COLUMNS = [
  { key: "store_name", label: "Store", align: "left" },
  { key: "total", label: "Leads" },
  { key: "coverage", label: "Worked" },
  { key: "hot", label: "Hot" },
  { key: "hotUntouched", label: "Hot uncalled" },
  { key: "converted", label: "Converted" },
  { key: "conversionRate", label: "Conv. rate" },
  { key: "revenueWon", label: "Revenue won" },
  { key: "idleHours", label: "Last activity" },
];

export default function AdminBoard({ data, previewMode }) {
  const { totals, stores, staff, thresholds } = data;
  const [sortKey, setSortKey] = useState("revenueAtRisk");
  const [asc, setAsc] = useState(false);
  const [q, setQ] = useState("");
  const router = useRouter();

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const matched = stores.filter((s) =>
      !needle ? true : s.store_name.toLowerCase().includes(needle)
    );
    return [...matched].sort((a, b) => {
      const x = a[sortKey];
      const y = b[sortKey];
      // "Last activity" sorts by idleHours, where never-active (null) is the
      // worst case and must not float to the top as if it were zero.
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      const cmp =
        typeof x === "string" ? x.localeCompare(y) : x === y ? 0 : x < y ? -1 : 1;
      return asc ? cmp : -cmp;
    });
  }, [stores, sortKey, asc, q]);

  function sortBy(key) {
    if (key === sortKey) return setAsc((v) => !v);
    setSortKey(key);
    // Names read best A–Z; every number reads best biggest-first.
    setAsc(key === "store_name");
  }

  const attention = useMemo(
    () =>
      stores
        .filter((s) => s.flags.some((f) => f.level === "bad"))
        .sort((a, b) => b.revenueAtRisk - a.revenueAtRisk || b.hotUntouched - a.hotUntouched),
    [stores]
  );

  async function logout() {
    await fetch("/api/admin-logout", { method: "POST" });
    router.refresh();
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="store-name">
            Area manager
            <small>
              All {totals.stores} stores · {totals.leads.toLocaleString("en-IN")}{" "}
              leads
            </small>
          </div>
          <a className="link-btn" href="/">
            Store view
          </a>
          <button className="link-btn" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>

      <main className="page">
        {previewMode && (
          <div className="warn">
            <b>Preview mode.</b> No Google Sheet connected, so call activity
            resets whenever the server restarts. Every store will read as “not
            started” until the Sheet is wired up.
          </div>
        )}

        <div className="stats admin-stats">
          <div className="stat">
            <b>{totals.leads.toLocaleString("en-IN")}</b>
            <span>Total leads</span>
          </div>
          <div className="stat">
            <b>{pct(totals.coverage)}</b>
            <span>Worked ({totals.worked.toLocaleString("en-IN")})</span>
          </div>
          <div className="stat">
            <b>{totals.converted.toLocaleString("en-IN")}</b>
            <span>Converted ({pct(totals.conversionRate)})</span>
          </div>
          <div className="stat">
            <b>{money(totals.revenueWon)}</b>
            <span>Revenue won</span>
          </div>
          <div className={`stat ${totals.hotUntouched ? "bad" : ""}`}>
            <b>{totals.hotUntouched.toLocaleString("en-IN")}</b>
            <span>Hot uncalled · {money(totals.revenueAtRisk)} at risk</span>
          </div>
          <div className={`stat ${totals.silentStores ? "bad" : ""}`}>
            <b>{totals.silentStores}</b>
            <span>Stores not working</span>
          </div>
        </div>

        {attention.length > 0 && (
          <section className="panel attention">
            <h3>
              Needs attention
              <small>
                Stores that have gone quiet for {thresholds.silentHours}h or are
                sitting on uncalled hot leads, worst first
              </small>
            </h3>
            <div className="attn-list">
              {attention.map((s) => (
                <div key={s.store_id} className="attn">
                  <div className="attn-head">
                    <b>{s.store_name}</b>
                    {s.revenueAtRisk > 0 && (
                      <span className="attn-risk">
                        {money(s.revenueAtRisk)} at risk
                      </span>
                    )}
                  </div>
                  <div className="flags">
                    {s.flags.map((f) => (
                      <span key={f.key} className={`flag ${f.level}`} title={f.detail}>
                        {f.label}
                      </span>
                    ))}
                  </div>
                  <div className="attn-detail">
                    {s.flags.map((f) => f.detail).join(" · ")}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="panel">
          <h3>
            Every store
            <small>Click any column to re-rank</small>
          </h3>

          <input
            className="search"
            style={{ margin: "0 0 12px", width: "100%" }}
            placeholder="Find a store…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />

          <div className="table-wrap">
            <table className="grid">
              <thead>
                <tr>
                  {COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      className={`${c.align === "left" ? "l" : ""} ${
                        sortKey === c.key ? "on" : ""
                      }`}
                      onClick={() => sortBy(c.key)}
                    >
                      {c.label}
                      {sortKey === c.key ? (asc ? " ▲" : " ▼") : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.store_id} className={!s.active ? "off" : ""}>
                    <td className="l">
                      <div className="cell-store">{s.store_name}</div>
                      {s.flags.length > 0 && (
                        <div className="flags">
                          {s.flags.map((f) => (
                            <span
                              key={f.key}
                              className={`flag ${f.level}`}
                              title={f.detail}
                            >
                              {f.label}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td>{s.total.toLocaleString("en-IN")}</td>
                    <td>
                      {pct(s.coverage)}
                      <small className="sub">{s.worked}</small>
                    </td>
                    <td>{s.hot}</td>
                    <td className={s.hotUntouched ? "danger" : ""}>
                      {s.hotUntouched}
                    </td>
                    <td>{s.converted}</td>
                    <td>{pct(s.conversionRate)}</td>
                    <td>{money(s.revenueWon)}</td>
                    <td className={s.idleHours === null ? "danger" : ""}>
                      {relTime(s.lastActivity, s.idleHours)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <h3>
            Who's making the calls
            <small>
              From the Updates log — {totals.updatesLogged.toLocaleString("en-IN")}{" "}
              status changes recorded
            </small>
          </h3>
          {staff.length === 0 ? (
            <div className="empty">
              Nobody has logged a call yet. Staff type their name on the store
              dashboard and it's written onto every update.
            </div>
          ) : (
            <div className="table-wrap">
              <table className="grid">
                <thead>
                  <tr>
                    <th className="l">Name</th>
                    <th>Updates logged</th>
                    <th>Stores</th>
                  </tr>
                </thead>
                <tbody>
                  {staff.map((p) => (
                    <tr key={p.name}>
                      <td className="l">{p.name}</td>
                      <td>{p.updates.toLocaleString("en-IN")}</td>
                      <td>{p.stores}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
