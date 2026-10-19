import "server-only";
import { redirect } from "next/navigation";
import { prisma } from "./prisma";
import { readSession } from "./session";
import { AppError } from "./errors";

export async function getCurrentUser() {
  const session = await readSession();
  if (!session) return null;

  const user = await prisma.user.findUnique({ where: { id: session.userId }, include: { organization: true } });
  if (!user) return null;
  if (user.isActive === false) return null;
  if ((session.sessionVersion ?? 0) !== (user.sessionVersion ?? 0)) return null;

  return user;
}

// Qualquer usuário autenticado (super-admin incluído, mesmo sem organização).
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) {
    // Se há sessão mas o usuário sumiu, só ir para /login não basta: o proxy
    // acha a sessão válida e devolve para "/" (loop). Limpa o cookie antes.
    redirect((await readSession()) ? "/api/session/clear" : "/login");
  }
  return user;
}

// Usuário autenticado E pertencendo a uma organização ativa — é o que toda
// página/action do CRM "normal" (fora do painel /admin) deve usar: garante
// que `organizationId` abaixo nunca é null, então toda query pode confiar
// nele pra isolar os dados de uma empresa das outras.
export async function requireOrgUser() {
  const user = await requireUser();
  if (!user.organizationId || !user.organization) {
    // Super-admin sem empresa usa o painel /admin; qualquer outro usuário sem
    // empresa não tem onde ficar — limpa a sessão em vez de entrar em loop
    // (/admin devolve para /dashboard, que devolve para /admin…).
    redirect(user.isSuperAdmin ? "/admin" : "/api/session/clear");
  }
  if (user.organization.status === "SUSPENDED") {
    redirect("/api/session/clear?error=org_suspended");
  }
  return { ...user, organizationId: user.organizationId, organization: user.organization };
}

// Administrador da empresa (role ADMIN). Para server actions: quem não é
// administrador recebe um erro — esconder o botão na tela não basta, porque uma
// server action pode ser chamada direto.
export async function requireAdminUser() {
  const user = await requireOrgUser();
  if (user.role !== "ADMIN") {
    throw new AppError("sem_permissao", "Apenas administradores podem fazer isso.", 403);
  }
  return user;
}

// Mesma regra para páginas: quem não é administrador volta ao dashboard.
export async function requireAdminPage() {
  const user = await requireOrgUser();
  if (user.role !== "ADMIN") redirect("/dashboard");
  return user;
}

// Só o(s) super-admin(s) da plataforma — usado pelas rotas /admin/*.
export async function requireSuperAdmin() {
  const user = await requireUser();
  if (!user.isSuperAdmin) redirect("/dashboard");
  return user;
}
