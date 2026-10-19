import Link from "next/link";
import { RecoveryForm } from "@/components/RecoveryForm";
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return <div className="content"><h1>Link inválido</h1><Link href="/forgot-password">Solicitar outro link</Link></div>;
  return <RecoveryForm token={token} />;
}
