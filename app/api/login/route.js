import { NextResponse } from "next/server";
import { getStoreByCode } from "../../../lib/data";
import { setSession } from "../../../lib/session";
import { checkRateLimit, recordFailure, clearFailures } from "../../../lib/ratelimit";

export const dynamic = "force-dynamic";

export async function POST(req) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

  const limit = checkRateLimit(ip);
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

  const store = await getStoreByCode(body?.code);
  if (!store) {
    recordFailure(ip);
    // Deliberately vague — don't tell a guesser which part was wrong.
    return NextResponse.json(
      { ok: false, error: "That code didn't work. Check with your manager." },
      { status: 401 }
    );
  }

  clearFailures(ip);
  setSession(store.store_id);
  return NextResponse.json({ ok: true, store: store.store_name });
}
