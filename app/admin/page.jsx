import { isAdmin } from "../../lib/session";
import { getAdminOverview } from "../../lib/data";
import { sheetsConfigured } from "../../lib/sheets";
import AdminLogin from "../../components/AdminLogin";
import AdminBoard from "../../components/AdminBoard";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  // The gate. getAdminOverview() is the only cross-store reader in the app and
  // it is never reached without a valid admin cookie.
  if (!isAdmin()) {
    return <AdminLogin configured={Boolean(process.env.ADMIN_CODE)} />;
  }

  const overview = await getAdminOverview();
  return <AdminBoard data={overview} previewMode={!sheetsConfigured()} />;
}
