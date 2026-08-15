import { NextResponse } from "next/server";
import { clearAdminSession } from "../../../../lib/session";

export const dynamic = "force-dynamic";

export async function POST() {
  clearAdminSession();
  return NextResponse.json({ ok: true });
}
