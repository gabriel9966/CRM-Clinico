import { vi } from "vitest";

// Mock mínimo do Prisma Client: cada método de cada "model" é um vi.fn()
// que o teste configura com mockResolvedValueOnce/mockImplementation.
// Isso deixa testar a lógica de negócio (isolamento multi-tenant, validações)
// sem precisar de um Postgres real rodando.
function makeModel() {
  return {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  };
}

export function createMockPrisma() {
  return {
    user: makeModel(),
    organization: makeModel(),
    contact: makeModel(),
    contactChannel: makeModel(),
    pipeline: makeModel(),
    stage: makeModel(),
    opportunity: makeModel(),
    message: makeModel(),
    conversation: makeModel(),
    activity: makeModel(),
    appointment: makeModel(),
    connection: makeModel(),
    automation: makeModel(),
    automationRun: makeModel(),
    automationSchedule: makeModel(),
    mcpConfig: makeModel(),
    opportunityStageHistory: makeModel(),
    professional: makeModel(),
    procedure: makeModel(),
    room: makeModel(),
    scheduleBlock: makeModel(),
    auditLog: makeModel(),
    webhookLog: makeModel(),
    inboundWebhook: makeModel(),
    campaign: makeModel(),
    campaignRecipient: makeModel(),
    // O mock não tem transação real: executa o callback com o próprio mock.
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
  };
}

export type MockPrisma = ReturnType<typeof createMockPrisma>;
