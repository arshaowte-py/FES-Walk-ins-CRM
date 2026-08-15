import { NextResponse } from "next/server";
import { currentStoreId } from "../../../lib/session";
import { saveUpdate } from "../../../lib/data";

export const dynamic = "force-dynamic";

export async function POST(req) {
  const storeId = currentStoreId();
  if (!storeId) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request" }, { status: 400 });
  }

  // storeId comes from the signed cookie, never from the request body.
  const result = await saveUpdate({
    storeId,
    leadId: body?.leadId,
    status: body?.status,
    notes: body?.notes,
    updatedBy: body?.updatedBy,
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json(result);
}
