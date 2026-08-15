"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginForm() {
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const inputRef = useRef(null);

  async function submit(e) {
    e.preventDefault();
    if (code.length !== 4 || busy) return;

    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });

      // A crashed route handler returns an HTML error page, and calling
      // res.json() on it throws — which used to land in the catch below and
      // report a server misconfiguration as "Network problem". Read the body
      // defensively so a broken deployment reads as broken.
      let data;
      try {
        data = await res.json();
      } catch {
        setErr(
          res.status >= 500
            ? "The server hit an error signing you in. Whoever deployed this needs to check its settings."
            : "Got an unexpected response from the server. Try again in a moment."
        );
        setBusy(false);
        return;
      }

      if (data.ok) {
        router.replace("/dashboard");
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
          Enter your store's 4-digit code to see your walk-in leads.
        </p>

        <input
          ref={inputRef}
          className="code-input"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
          inputMode="numeric"
          autoComplete="off"
          placeholder="––––"
          aria-label="Store access code"
          autoFocus
        />

        <button className="btn" disabled={code.length !== 4 || busy}>
          {busy ? "Checking…" : "View my leads"}
        </button>

        {err && <div className="error">{err}</div>}

        <div className="login-foot">
          Don't have a code? Ask your area manager.
        </div>
      </form>
    </div>
  );
}
