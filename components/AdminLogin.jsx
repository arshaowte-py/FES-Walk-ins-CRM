"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLogin() {
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
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (data.ok) {
        router.replace("/admin");
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
        <div className="admin-tag">Head office</div>
        <p className="login-sub">
          Enter the admin code to see every store.
        </p>

        <input
          ref={inputRef}
          className="code-input admin-code-input"
          type="password"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="current-password"
          placeholder="••••••"
          aria-label="Admin access code"
          autoFocus
        />

        <button className="btn" disabled={!code || busy}>
          {busy ? "Checking…" : "Open dashboard"}
        </button>

        {err && <div className="error">{err}</div>}

        <div className="login-foot">
          Store staff sign in on the <a href="/">main page</a>.
        </div>
      </form>
    </div>
  );
}
