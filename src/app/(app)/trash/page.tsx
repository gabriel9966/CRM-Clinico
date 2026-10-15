import { redirect } from "next/navigation";
import { requireOrgUser } from "@/lib/auth";
import { listTrash } from "@/lib/trash";
import { TrashView } from "@/components/trash/TrashView";

export default async function TrashPage() {
  const user = await requireOrgUser();
  if (user.role !== "ADMIN") redirect("/dashboard");
  const items = await listTrash(user.organizationId);
  return <TrashView items={items} />;
}
