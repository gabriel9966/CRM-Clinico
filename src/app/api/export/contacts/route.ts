import { requireOrgUser } from "@/lib/auth";
import { getTeamMembers } from "@/lib/data";
import { prisma } from "@/lib/prisma";
import { csvDownload } from "@/lib/export";
import { audit, actorOf } from "@/lib/audit";
import { hasModulePermission } from "@/lib/access";

const BATCH = 1000;

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function GET() {
  const user = await requireOrgUser();
  if (!hasModulePermission(user, "contacts.read") || !hasModulePermission(user, "data.import_export")) {
    return new Response("Sem permissão para exportar contatos.", { status: 403 });
  }
  const { organizationId } = user;
  const team = await getTeamMembers(organizationId);
  const ownerName = (id: string | null) => (id ? team.find((m) => m.id === id)?.name ?? "" : "");

  // Exportar dados de clientes/pacientes fica registrado (LGPD).
  await audit(organizationId, { action: "contact.exported", entity: "Contact", ...actorOf(user) });

  return csvDownload("contatos.csv", ["name", "company", "email", "phone", "tags", "notes", "owner", "source", "score", "marketing_opt_out"], async (cursor) => {
    const rows = await prisma.contact.findMany({
      where: { organizationId },
      orderBy: { id: "asc" },
      take: BATCH + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > BATCH;
    const page = hasMore ? rows.slice(0, BATCH) : rows;
    return {
      rows: page.map((c) => ({
        name: c.name,
        company: c.company ?? "",
        email: c.email ?? "",
        phone: c.phone ?? "",
        tags: parseTags(c.tags).join(";"),
        notes: c.notes ?? "",
        owner: ownerName(c.ownerId),
        source: c.source ?? "",
        score: c.score,
        marketing_opt_out: c.marketingOptOut ? "sim" : "não",
      })),
      next: hasMore ? page[page.length - 1].id : null,
    };
  });
}
