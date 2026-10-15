import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockPrisma } from "../../../test/mock-prisma";

const mockPrisma = createMockPrisma();
vi.mock("../prisma", () => ({ prisma: mockPrisma }));
vi.mock("../session", () => ({ readSession: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const { readSession } = await import("../session");
const { redirect } = await import("next/navigation");
const { requireAdminUser, requireAdminPage, requireOrgUser, requireUser } = await import("../auth");

function loggedAs(role: "ADMIN" | "MEMBER", over: Record<string, unknown> = {}) {
  vi.mocked(readSession).mockResolvedValue({ userId: "u1" } as never);
  mockPrisma.user.findUnique.mockResolvedValue({
    id: "u1",
    role,
    organizationId: "org-1",
    organization: { id: "org-1", status: "ACTIVE" },
    ...over,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  // redirect() do Next lança uma exceção especial; aqui vira um erro identificável.
  vi.mocked(redirect).mockImplementation(((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }) as never);
});

describe("requireAdminUser (server actions)", () => {
  it("deixa o administrador passar", async () => {
    loggedAs("ADMIN");
    await expect(requireAdminUser()).resolves.toMatchObject({ id: "u1", organizationId: "org-1" });
  });

  it("recusa atendente comum com erro 403 (não basta esconder o botão)", async () => {
    loggedAs("MEMBER");
    await expect(requireAdminUser()).rejects.toMatchObject({ code: "sem_permissao", status: 403 });
  });

  it("sem sessão manda para o login", async () => {
    vi.mocked(readSession).mockResolvedValue(null as never);
    await expect(requireAdminUser()).rejects.toThrow("REDIRECT:/login");
  });

  it("organização suspensa não passa nem sendo administrador (limpa a sessão, sem loop)", async () => {
    loggedAs("ADMIN", { organization: { id: "org-1", status: "SUSPENDED" } });
    await expect(requireAdminUser()).rejects.toThrow("REDIRECT:/api/session/clear?error=org_suspended");
  });

  // Regressão do ERR_TOO_MANY_REDIRECTS: sessão assinada válida cujo usuário
  // não existe mais. Ir só para /login faz o proxy devolver para "/" (loop).
  it("sessão órfã (usuário não existe mais) limpa o cookie em vez de ir direto ao /login", async () => {
    vi.mocked(readSession).mockResolvedValue({ userId: "apagado" } as never);
    mockPrisma.user.findUnique.mockResolvedValue(null);
    await expect(requireUser()).rejects.toThrow("REDIRECT:/api/session/clear");
  });

  it("usuário comum sem empresa também limpa a sessão; super-admin sem empresa vai ao painel", async () => {
    loggedAs("MEMBER", { organizationId: null, organization: null, isSuperAdmin: false });
    await expect(requireOrgUser()).rejects.toThrow("REDIRECT:/api/session/clear");
    loggedAs("ADMIN", { organizationId: null, organization: null, isSuperAdmin: true });
    await expect(requireOrgUser()).rejects.toThrow("REDIRECT:/admin");
  });
});

describe("requireAdminPage (páginas)", () => {
  it("administrador vê a página", async () => {
    loggedAs("ADMIN");
    await expect(requireAdminPage()).resolves.toMatchObject({ role: "ADMIN" });
  });

  it("atendente comum volta ao dashboard", async () => {
    loggedAs("MEMBER");
    await expect(requireAdminPage()).rejects.toThrow("REDIRECT:/dashboard");
  });
});

describe("requireOrgUser", () => {
  it("atendente comum continua podendo usar o CRM normal", async () => {
    loggedAs("MEMBER");
    await expect(requireOrgUser()).resolves.toMatchObject({ role: "MEMBER" });
  });
});
