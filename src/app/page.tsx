import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";

export default async function RootPage() {
  const user = await requireUser();
  redirect(user.isSuperAdmin ? "/admin" : "/dashboard");
}
