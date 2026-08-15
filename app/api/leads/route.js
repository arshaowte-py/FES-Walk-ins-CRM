import { NextResponse } from "next/server";
import { currentStoreId } from "../../../lib/session";
import { getLeadsForStore, summarise } from "../../../lib/data";

export const dynamic = "force-dynamic";

export async function GET() {
  const storeId = currentStoreId();
  if (!storeId) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  const leads = await getLeadsForStore(storeId);
  return NextResponse.json({ ok: true, leads, summary: summarise(leads) });
}
