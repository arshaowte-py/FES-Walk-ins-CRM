import { isAdmin, adminConfigured } from "../../lib/session";
import { getAdminOverview } from "../../lib/data";
import { sheetsConfigured } from "../../lib/sheets";
import AdminLogin from "../../components/AdminLogin";
import AdminBoard from "../../components/AdminBoard";

export const dynamic = "force-dynamic";

export default async function Admin() {
  if (!adminConfigured()) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <h1 className="brand">
            frido<span>.</span>
          </h1>
          <p className="login-sub">
            Admin access isn't set up. Add an <code>ADMIN_CODE</code> environment
            variable and redeploy.
          </p>
        </div>
      </div>
    );
  }

  // The overview crosses store boundaries, so it is only ever built after this
  // check passes.
  if (!isAdmin()) return <AdminLogin />;

  const overview = await getAdminOverview();
  return <AdminBoard data={overview} previewMode={!sheetsConfigured()} />;
}
