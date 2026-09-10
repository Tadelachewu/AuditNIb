import { redirect } from "next/navigation";
import { readDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";
import { AdminDashboard } from "@/components/dashboard/AdminDashboard";

export default async function AdminDashboardPage() {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.permissions, permissionKey("admin-dashboard", "view"))) {
    redirect("/dashboard");
  }

  const db = await readDb();
  return <AdminDashboard user={user} db={db} />;
}
