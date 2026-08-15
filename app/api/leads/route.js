import { NextResponse } from "next/server";
import { currentStoreId } from "../../../lib/session";
import { getLeadsForStore, summarise } from "../../../lib/data";
import { DEFAULT_SORT, isSort } from "../../../lib/sorting";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const storeId = currentStoreId();
  if (!storeId) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  // An unknown sort falls back to the default rather than erroring — the store
  // id still comes only from the cookie, so this can't widen what's returned.
  const requested = new URL(req.url).searchParams.get("sort");
  const sort = isSort(requested) ? requested : DEFAULT_SORT;

  const leads = await getLeadsForStore(storeId, sort);
  return NextResponse.json({ ok: true, sort, leads, summary: summarise(leads) });
}
