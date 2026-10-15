import { getTeamMembers, getGoogleConnectedUserIds } from "@/lib/data";
import { getAppointmentsPage } from "@/lib/queries";
import { requireOrgUser } from "@/lib/auth";
import { AppointmentsView } from "@/components/appointments/AppointmentsView";

export default async function AppointmentsPage() {
  const user = await requireOrgUser();
  // Só a primeira página dos próximos agendamentos; "Anteriores" e "Carregar
  // mais" vão ao servidor. Contatos aparecem pelo nome já na linha.
  const [page, team, googleConnected] = await Promise.all([
    getAppointmentsPage(user.organizationId, { range: "upcoming" }),
    getTeamMembers(user.organizationId),
    getGoogleConnectedUserIds(user.organizationId),
  ]);

  return (
    <AppointmentsView
      initialPage={page}
      team={team}
      currentUserId={user.id}
      googleConnectedUserIds={[...googleConnected]}
    />
  );
}
