import { redirect } from "next/navigation";
import { currentStoreId } from "../lib/session";
import LoginForm from "../components/LoginForm";

export const dynamic = "force-dynamic";

export default function Home() {
  if (currentStoreId()) redirect("/dashboard");
  return <LoginForm />;
}
