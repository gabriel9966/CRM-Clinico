import "server-only";
import { prisma } from "./prisma";

export async function getOrganizationsWithStats() {
  const orgs = await prisma.organization.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: {
          users: true,
          contacts: { where: { deletedAt: null } },
          opportunities: { where: { deletedAt: null } },
          pipelines: true,
        },
      },
    },
  });
  return orgs.map((o) => ({
    id: o.id,
    name: o.name,
    slug: o.slug,
    status: o.status,
    createdAt: o.createdAt.toISOString(),
    userCount: o._count.users,
    contactCount: o._count.contacts,
    opportunityCount: o._count.opportunities,
    pipelineCount: o._count.pipelines,
  }));
}

export type OrganizationWithStats = Awaited<ReturnType<typeof getOrganizationsWithStats>>[number];
