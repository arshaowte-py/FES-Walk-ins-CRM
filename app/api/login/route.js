import { NextResponse } from "next/server";
import { getStoreByCode } from "../../../lib/data";
import { setSession } from "../../../lib/session";
import { checkRateLimit, recordFailure, clearFailures } from "../../../lib/ratelimit";

export const dynamic = "force-dynamic";

export async function POST(req) {
  // Without this the route throws deep inside setSession(), Next serves an HTML
  // 500, the browser's res.json() chokes on it, and the store person is told
  // "Network problem" for what is actually an unfinished deployment. Check it
  // up front and say so plainly instead.
  if (!process.env.SESSION_SECRET) {
    console.error("SESSION_SECRET is not set — login cannot issue a cookie.");
    return NextResponse.json(
      {
        ok: false,
        error:
          "This deployment isn't finished — its session secret is missing. Ask whoever set it up.",
      },
      { status: 503 }
    );
  }

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

  let store;
  try {
    store = await getStoreByCode(body?.code);
  } catch (err) {
    // Almost always a malformed GOOGLE_PRIVATE_KEY — the \n escapes get mangled
    // on the way into Vercel. Answer in JSON so the UI can say something true.
    console.error("Could not read the Stores tab:", err);
    return NextResponse.json(
      {
        ok: false,
        error:
          "Can't reach the store list right now. If the Google Sheet was just connected, check GOOGLE_PRIVATE_KEY.",
      },
      { status: 502 }
    );
  }

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
