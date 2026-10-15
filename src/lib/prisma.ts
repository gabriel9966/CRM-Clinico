import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Contact, Opportunity e Appointment têm lixeira (campo deletedAt). Em vez de
// lembrar de filtrar `deletedAt: null` em cada consulta do sistema, a extensão
// abaixo faz isso em TODA leitura/atualização desses modelos — esquecer o
// filtro deixaria de ser possível. Apagar de verdade passa a ser proibido por
// aqui: use softDelete* (lib/soft-delete.ts); restaurar e excluir
// definitivamente é com lib/trash.ts, que usa o cliente sem filtro (prismaRaw).

const SOFT_MODELS = ["contact", "opportunity", "appointment"] as const;

type Where = Record<string, unknown> | undefined;
const live = (where: Where) => ({ ...(where ?? {}), deletedAt: null });

const FILTERED_OPS = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
]);

function softDeleteGuard(model: string) {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async $allOperations({ operation, args, query }: { operation: string; args: any; query: (a: any) => Promise<unknown> }) {
      if (operation === "delete" || operation === "deleteMany") {
        throw new Error(
          `Exclusão física de ${model} bloqueada: use softDelete* (lib/soft-delete.ts) para mandar para a lixeira ou purge* (lib/trash.ts) para apagar de vez.`
        );
      }
      if (FILTERED_OPS.has(operation)) {
        return query({ ...args, where: live(args?.where) });
      }
      return query(args);
    },
  };
}

const globalForPrisma = globalThis as unknown as { prismaRaw?: PrismaClient };

// DB_POOL_MAX limita as conexões abertas (padrão do driver: 10). Útil em banco
// pequeno ou compartilhado com outros serviços.
const poolMax = Number(process.env.DB_POOL_MAX) || undefined;
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL!, max: poolMax });

/** Cliente SEM filtro de lixeira. Só para lib/trash.ts e manutenção. */
export const prismaRaw = globalForPrisma.prismaRaw ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prismaRaw = prismaRaw;
}

/** Cliente padrão do app: não enxerga o que está na lixeira. */
export const prisma = prismaRaw.$extends({
  query: {
    contact: softDeleteGuard("contact"),
    opportunity: softDeleteGuard("opportunity"),
    appointment: softDeleteGuard("appointment"),
  },
});

export { SOFT_MODELS };

/** Cliente de transação do `prisma` estendido. */
export type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
/** Aceita o cliente normal ou o de dentro de uma transação. */
export type DbClient = typeof prisma | TxClient;
