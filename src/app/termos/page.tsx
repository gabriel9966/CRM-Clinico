import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/LegalPage";

export const metadata: Metadata = { title: "Termos de Uso — NovaCRM" };

const CONTACT = "kodexxti@gmail.com";

export default function TermosPage() {
  return (
    <LegalPage title="Termos de Uso" updatedAt="19 de outubro de 2026">
      <p>
        Estes termos regem o uso do NovaCRM, sistema oferecido pela Kodexx. Ao acessar o sistema, você concorda
        com eles.
      </p>

      <h2>1. Acesso</h2>
      <p>
        O acesso é feito com contas criadas pelo administrador da empresa cliente. Cada usuário é responsável por
        manter suas credenciais em sigilo e pelas ações realizadas com a sua conta.
      </p>

      <h2>2. Uso permitido</h2>
      <ul>
        <li>Usar o sistema apenas para a gestão de clientes, atendimento e agenda da empresa.</li>
        <li>Cadastrar somente dados que a empresa tenha base legal para tratar.</li>
        <li>Não tentar acessar dados de outras empresas, burlar controles de segurança ou sobrecarregar o serviço.</li>
      </ul>

      <h2>3. Dados</h2>
      <p>
        Os dados inseridos pertencem à empresa cliente. O tratamento é descrito na{" "}
        <Link href="/privacidade">Política de Privacidade</Link>.
      </p>

      <h2>4. Integrações</h2>
      <p>
        Integrações com serviços de terceiros (Google, WhatsApp, Instagram e outros) dependem da disponibilidade e
        das regras desses serviços. O usuário pode revogar as autorizações a qualquer momento.
      </p>

      <h2>5. Disponibilidade e alterações</h2>
      <p>
        Trabalhamos para manter o serviço disponível e seguro, mas podem ocorrer interrupções para manutenção.
        Estes termos podem ser atualizados; a data da última versão aparece no topo da página.
      </p>

      <h2>6. Contato</h2>
      <p>
        <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
      </p>
    </LegalPage>
  );
}
