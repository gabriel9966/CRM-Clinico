import { redirect } from "next/navigation";
import { requireOrgUser } from "@/lib/auth";
import { listAuditLogs } from "@/lib/audit";
import { AuditView } from "@/components/audit/AuditView";

export default async function AuditPage() {
  const user = await requireOrgUser();
  if (user.role !== "ADMIN") redirect("/dashboard");
  const page = await listAuditLogs(user.organizationId, { limit: 50 });
  return <AuditView initialItems={page.items} initialCursor={page.nextCursor} />;
}
