import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockPrisma } from "../../../../test/mock-prisma";
import type { Flow } from "../types";

const mockPrisma = createMockPrisma();

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/mcp-tools", () => ({
  mcpSendMessage: vi.fn().mockResolvedValue({ ok: true }),
  mcpCreateContact: vi.fn().mockResolvedValue({ id: "new-contact" }),
  mcpCreateOpportunity: vi.fn().mockResolvedValue({ id: "new-opportunity" }),
}));
vi.mock("../sandbox", () => ({ runCode: vi.fn().mockResolvedValue({ ok: true }) }));

const { runAutomationById, triggerAppointmentAutomations } = await import("../engine");
const { mcpCreateContact, mcpCreateOpportunity } = await import("@/lib/mcp-tools");

const ORG_A = "org-a";
const ORG_B = "org-b";

function flowWith(nodeData: Flow["nodes"][number]["data"]): Flow {
  return {
    nodes: [
      { id: "trigger", type: "trigger", position: { x: 0, y: 0 }, data: { kind: "trigger", label: "Webhook" } },
      { id: "n1", type: "x", position: { x: 0, y: 0 }, data: nodeData },
    ],
    edges: [{ id: "e1", source: "trigger", target: "n1" }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.automationRun.create.mockResolvedValue({ id: "run-1" });
  mockPrisma.automationRun.update.mockResolvedValue({});
});

describe("triggerAppointmentAutomations", () => {
  const appointment = {
    id: "appointment-1",
    contactId: "contact-1",
    ownerId: "owner-1",
    professionalId: "professional-1",
    procedureId: "procedure-1",
    bookingChannel: "WhatsApp",
    startAt: new Date("2026-10-20T14:00:00.000Z"),
    status: "SCHEDULED",
  };

  it("inicia o fluxo do agendamento e registra o id para impedir reenvio", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([
      {
        id: "auto-appointment",
        organizationId: ORG_A,
        trigger: "APPOINTMENT_CREATED",
        triggerConfig: "{}",
        flow: JSON.stringify(flowWith({ kind: "action", actionType: "send_message", config: { text: "Lembrete" } })),
      },
    ]);

    await triggerAppointmentAutomations(ORG_A, "APPOINTMENT_CREATED", appointment);

    expect(mockPrisma.automationRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          automationId: "auto-appointment",
          appointmentId: "appointment-1",
          contactId: "contact-1",
        }),
      })
    );
    expect(mockPrisma.automationRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETED" }) })
    );
  });

  it("respeita o filtro opcional de responsavel do agendamento", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([
      {
        id: "auto-other-owner",
        organizationId: ORG_A,
        trigger: "APPOINTMENT_CREATED",
        triggerConfig: JSON.stringify({ ownerId: "owner-2" }),
        flow: JSON.stringify(flowWith({ kind: "action", actionType: "send_message", config: { text: "Lembrete" } })),
      },
    ]);

    await triggerAppointmentAutomations(ORG_A, "APPOINTMENT_CREATED", appointment);

    expect(mockPrisma.automationRun.create).not.toHaveBeenCalled();
  });
});

describe("runAutomationById: validações básicas", () => {
  it("recusa quando a automação não existe", async () => {
    mockPrisma.automation.findUnique.mockResolvedValue(null);
    const result = await runAutomationById("missing", {});
    expect(result.ok).toBe(false);
  });

  it("recusa quando a automação está desativada", async () => {
    mockPrisma.automation.findUnique.mockResolvedValue({ enabled: false, trigger: "WEBHOOK_RECEIVED" });
    const result = await runAutomationById("a1", {});
    expect(result.ok).toBe(false);
  });

  it("recusa quando o gatilho não é WEBHOOK_RECEIVED", async () => {
    mockPrisma.automation.findUnique.mockResolvedValue({ enabled: true, trigger: "STAGE_CHANGED" });
    const result = await runAutomationById("a1", {});
    expect(result.ok).toBe(false);
  });
});

describe("runAutomationById: isolamento multi-tenant no payload externo", () => {
  const automation = {
    id: "auto-1",
    organizationId: ORG_A,
    enabled: true,
    trigger: "WEBHOOK_RECEIVED",
    flow: JSON.stringify(flowWith({ kind: "action", actionType: "send_message", config: { text: "oi" } })),
  };

  it("ignora contactId do payload se o contato pertence a outra organização", async () => {
    mockPrisma.automation.findUnique.mockResolvedValue(automation);
    mockPrisma.contact.findFirst.mockResolvedValue(null); // contato não está na ORG_A

    await runAutomationById("auto-1", { contactId: "contact-of-org-b" });

    expect(mockPrisma.contact.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "contact-of-org-b", organizationId: ORG_A } })
    );
    expect(mockPrisma.automationRun.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ contactId: null }) })
    );
  });

  it("aceita contactId do payload quando o contato pertence à mesma organização", async () => {
    mockPrisma.automation.findUnique.mockResolvedValue(automation);
    mockPrisma.contact.findFirst.mockResolvedValue({ id: "contact-1", organizationId: ORG_A });

    await runAutomationById("auto-1", { contactId: "contact-1" });

    expect(mockPrisma.automationRun.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ contactId: "contact-1" }) })
    );
  });
});

describe("runAutomationById: ações isoladas por organização", () => {
  it("assign_owner recusa atribuir responsável de outra organização", async () => {
    const automation = {
      id: "auto-2",
      organizationId: ORG_A,
      enabled: true,
      trigger: "WEBHOOK_RECEIVED",
      flow: JSON.stringify(
        flowWith({ kind: "action", actionType: "assign_owner", config: { ownerId: "user-of-org-b", target: "contact" } })
      ),
    };
    mockPrisma.automation.findUnique.mockResolvedValue(automation);
    mockPrisma.user.findFirst.mockResolvedValue(null); // não encontrado na ORG_A

    await runAutomationById("auto-2", {});

    expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "user-of-org-b", organizationId: ORG_A } })
    );
    expect(mockPrisma.contact.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.opportunity.updateMany).not.toHaveBeenCalled();
  });

  it("move_stage recusa mover oportunidade que não pertence à organização da automação", async () => {
    const automation = {
      id: "auto-3",
      organizationId: ORG_A,
      enabled: true,
      trigger: "WEBHOOK_RECEIVED",
      flow: JSON.stringify(flowWith({ kind: "action", actionType: "move_stage", config: { stageId: "s1" } })),
    };
    mockPrisma.automation.findUnique.mockResolvedValue(automation);
    mockPrisma.contact.findFirst.mockResolvedValue({ id: "c1", organizationId: ORG_A });
    mockPrisma.opportunity.findFirst.mockResolvedValue(null); // oportunidade não está na ORG_A

    await runAutomationById("auto-3", { contactId: "c1", opportunityId: "opp-of-org-b" });

    expect(mockPrisma.opportunity.update).not.toHaveBeenCalled();
  });

  it("marca o run como COMPLETED ao final do fluxo", async () => {
    const automation = {
      id: "auto-4",
      organizationId: ORG_A,
      enabled: true,
      trigger: "WEBHOOK_RECEIVED",
      flow: JSON.stringify(flowWith({ kind: "action", actionType: "send_message", config: { text: "oi" } })),
    };
    mockPrisma.automation.findUnique.mockResolvedValue(automation);
    mockPrisma.contact.findFirst.mockResolvedValue({ id: "contact-1", organizationId: ORG_A });

    await runAutomationById("auto-4", { contactId: "contact-1" });

    expect(mockPrisma.automationRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETED" }) })
    );
  });

  it("marca o run como FAILED quando uma ação não pode ser executada", async () => {
    mockPrisma.automation.findUnique.mockResolvedValue({
      id: "auto-5", organizationId: ORG_A, enabled: true, trigger: "WEBHOOK_RECEIVED",
      flow: JSON.stringify(flowWith({ kind: "action", actionType: "send_message", config: { text: "oi" } })),
    });
    await runAutomationById("auto-5", {});
    expect(mockPrisma.automationRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) })
    );
  });

  it("cria contato e oportunidade usando os campos do webhook", async () => {
    const flow: Flow = {
      nodes: [
        { id: "trigger", type: "triggerNode", position: { x: 0, y: 0 }, data: { kind: "trigger", label: "WEBHOOK_RECEIVED" } },
        { id: "contact", type: "actionNode", position: { x: 1, y: 0 }, data: { kind: "action", actionType: "create_contact", config: { name: "{{payload.name}}", email: "{{payload.email}}" } } },
        { id: "opportunity", type: "actionNode", position: { x: 2, y: 0 }, data: { kind: "action", actionType: "create_opportunity", config: { title: "Proposta {{payload.name}}", pipelineId: "pipe-1", stageId: "stage-1", value: 1200 } } },
      ],
      edges: [{ id: "e1", source: "trigger", target: "contact" }, { id: "e2", source: "contact", target: "opportunity" }],
    };
    mockPrisma.automation.findUnique.mockResolvedValue({ id: "auto-6", organizationId: ORG_A, enabled: true, trigger: "WEBHOOK_RECEIVED", flow: JSON.stringify(flow) });
    await runAutomationById("auto-6", { name: "Maria", email: "maria@exemplo.com" });
    expect(mcpCreateContact).toHaveBeenCalledWith(ORG_A, expect.objectContaining({ name: "Maria", email: "maria@exemplo.com" }));
    expect(mcpCreateOpportunity).toHaveBeenCalledWith(ORG_A, expect.objectContaining({ title: "Proposta Maria", contactId: "new-contact" }));
    expect(mockPrisma.automationRun.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETED" }) }));
  });
});
