import Link from "next/link";
import { AuthCard, RecoveryForm } from "@/components/RecoveryForm";
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    return (
      <AuthCard title="Link inválido" subtitle="Este link de recuperação está incompleto ou expirou.">
        <Link href="/forgot-password" className="login-submit block w-full rounded-xl px-4 py-3 text-center text-sm font-semibold">Solicitar outro link</Link>
      </AuthCard>
    );
  }
  return <RecoveryForm token={token} />;
}
