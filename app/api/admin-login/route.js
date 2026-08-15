import crypto from "crypto";
import { NextResponse } from "next/server";
import { setAdminSession } from "../../../lib/session";
import { checkRateLimit, recordFailure, clearFailures } from "../../../lib/ratelimit";

export const dynamic = "force-dynamic";

/** Constant-time compare so the code can't be recovered a character at a time. */
function sameCode(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export async function POST(req) {
  const expected = process.env.ADMIN_CODE;

  // No code configured means no admin access at all. Failing closed matters
  // here — the alternative is an unprotected view of every store.
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "Admin access isn't configured on this deployment." },
      { status: 503 }
    );
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  // Separate bucket from the store login so staff fumbling their store code
  // can't lock the area manager out, and vice versa.
  const key = `admin:${ip}`;

  const limit = checkRateLimit(key);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        ok: false,
        error: `Too many attempts. Try again in about ${Math.ceil(
          limit.retryAfterSec / 60
        )} minutes.`,
      },
      { status: 429 }
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request" }, { status: 400 });
  }

  if (!sameCode(body?.code ?? "", expected)) {
    recordFailure(key);
    return NextResponse.json(
      { ok: false, error: "That admin code didn't work." },
      { status: 401 }
    );
  }

  clearFailures(key);
  setAdminSession();
  return NextResponse.json({ ok: true });
}
