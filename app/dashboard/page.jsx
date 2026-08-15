import { redirect } from "next/navigation";
import { currentStoreId } from "../../lib/session";
import { getStore, getLeadsForStore, summarise } from "../../lib/data";
import { sheetsConfigured } from "../../lib/sheets";
import LeadBoard from "../../components/LeadBoard";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const storeId = currentStoreId();
  if (!storeId) redirect("/");

  const store = await getStore(storeId);
  if (!store) redirect("/");

  const leads = await getLeadsForStore(storeId);

  return (
    <LeadBoard
      storeName={store.store_name}
      leads={leads}
      summary={summarise(leads)}
      previewMode={!sheetsConfigured()}
    />
  );
}
