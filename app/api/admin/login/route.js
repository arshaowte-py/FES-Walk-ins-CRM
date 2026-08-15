import { NextResponse } from "next/server";
import {
  adminConfigured,
  checkAdminCode,
  setAdminSession,
} from "../../../../lib/session";
import { checkRateLimit, recordFailure, clearFailures } from "../../../../lib/ratelimit";

export const dynamic = "force-dynamic";

export async function POST(req) {
  if (!adminConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Admin access isn't set up. Add an ADMIN_CODE." },
      { status: 503 }
    );
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

  // Namespaced so a store fumbling its code can't lock out head office, and
  // vice versa.
  const key = `admin:${ip}`;
  const limit = checkRateLimit(key);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        ok: false,
        error: `Too many wrong codes. Try again in about ${Math.ceil(
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

  if (!checkAdminCode(body?.code)) {
    recordFailure(key);
    return NextResponse.json(
      { ok: false, error: "That code didn't work." },
      { status: 401 }
    );
  }

  clearFailures(key);
  setAdminSession();
  return NextResponse.json({ ok: true });
}
