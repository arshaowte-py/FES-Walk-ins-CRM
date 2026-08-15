"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLogin({ configured }) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const inputRef = useRef(null);

  async function submit(e) {
    e.preventDefault();
    if (!code || busy) return;

    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/admin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (data.ok) {
        router.refresh();
      } else {
        setErr(data.error || "Something went wrong");
        setCode("");
        inputRef.current?.focus();
        setBusy(false);
      }
    } catch {
      setErr("Network problem. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h1 className="brand">
          frido<span>.</span>
        </h1>
        <p className="login-sub">
          Area manager view — every store, in one place.
        </p>

        {!configured ? (
          <div className="warn" style={{ marginBottom: 0 }}>
            <b>Not configured.</b> Set an <code>ADMIN_CODE</code> environment
            variable on this deployment to switch the admin view on.
          </div>
        ) : (
          <>
            <input
              ref={inputRef}
              className="code-input admin-code"
              type="password"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="off"
              placeholder="Admin code"
              aria-label="Admin code"
              autoFocus
            />

            <button className="btn" disabled={!code || busy}>
              {busy ? "Checking…" : "Open admin view"}
            </button>

            {err && <div className="error">{err}</div>}
          </>
        )}

        <div className="login-foot">
          Store staff sign in on the <a href="/">main page</a>.
        </div>
      </form>
    </div>
  );
}
