import { requireOrgUser } from "@/lib/auth";
import { AccountForm } from "@/components/AccountForm";
export default async function AccountPage() {
  const user = await requireOrgUser();
  return <><div className="topbar"><div><h1>Minha conta</h1><div className="sub">Seu perfil e a segurança do seu acesso.</div></div></div><div className="content"><AccountForm name={user.name} email={user.email} /></div></>;
}
