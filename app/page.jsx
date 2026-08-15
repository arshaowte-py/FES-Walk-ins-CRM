import { redirect } from "next/navigation";
import { currentStoreId } from "../lib/session";
import { getStore } from "../lib/data";
import LoginForm from "../components/LoginForm";

export const dynamic = "force-dynamic";

/**
 * Both this page and /dashboard have to agree on what counts as a signed-in
 * store, or they bounce the browser between each other forever.
 *
 * A signed cookie on its own is not enough. The store it names must still
 * exist in whichever source is live. Those can disagree: a cookie issued while
 * the app was running off the bundled snapshot names a snapshot store_id, and
 * the moment the Google Sheet is connected that id may not be in the Stores
 * tab. /dashboard already rejected that case and sent the browser here; this
 * page used to see a valid signature, send it straight back, and Safari would
 * give up with "too many redirects".
 *
 * So run the same check here and fall through to the login instead. Signing in
 * again overwrites the stale cookie.
 */
export default async function Home() {
  const storeId = currentStoreId();

  if (storeId) {
    const store = await getStore(storeId);
    if (store) redirect("/dashboard");

    console.warn(
      `Session names store "${storeId}", which is not in the current Stores ` +
        `data. Showing the login instead. If this is happening to everyone, ` +
        `the store_id column in the Sheet probably doesn't match what the ` +
        `codes were issued against.`
    );
  }

  return <LoginForm />;
}
