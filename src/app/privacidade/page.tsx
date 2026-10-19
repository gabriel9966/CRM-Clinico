import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";

export const metadata: Metadata = { title: "Política de Privacidade — NovaCRM" };

const CONTACT = "kodexxti@gmail.com";

export default function PrivacidadePage() {
  return (
    <LegalPage title="Política de Privacidade" updatedAt="19 de outubro de 2026">
      <p>
        O NovaCRM é um sistema de gestão de relacionamento com clientes oferecido pela Kodexx a clínicas e
        empresas. Esta política explica quais dados tratamos, para quê e quais são os seus direitos, nos termos
        da Lei Geral de Proteção de Dados (Lei nº 13.709/2018).
      </p>

      <h2>1. Papéis</h2>
      <p>
        Cada empresa cliente é a <strong>controladora</strong> dos dados de seus contatos e pacientes cadastrados
        no NovaCRM. A Kodexx atua como <strong>operadora</strong>, tratando esses dados apenas para prestar o
        serviço, conforme as instruções da empresa cliente.
      </p>

      <h2>2. Dados que tratamos</h2>
      <ul>
        <li><strong>Usuários do sistema:</strong> nome, e-mail, senha (armazenada apenas como hash), perfil de acesso e registros de atividade.</li>
        <li><strong>Contatos e pacientes cadastrados pela empresa:</strong> dados de identificação e contato, histórico de conversas, agendamentos, oportunidades e anotações inseridas pela equipe.</li>
        <li><strong>Dados técnicos:</strong> endereço IP, data e hora de acesso e informações do navegador, usados para segurança e prevenção de abuso.</li>
      </ul>

      <h2>3. Uso de dados de contas Google</h2>
      <p>O NovaCRM pode se conectar ao Google de duas formas, sempre por iniciativa do próprio usuário:</p>
      <ul>
        <li>
          <strong>Entrar com Google:</strong> recebemos apenas o seu endereço de e-mail verificado, usado para
          identificar uma conta já existente no NovaCRM. Não criamos contas nem acessamos outros dados.
        </li>
        <li>
          <strong>Google Agenda:</strong> com a sua autorização, criamos, atualizamos e removemos na sua agenda os
          eventos correspondentes aos agendamentos feitos no NovaCRM. Guardamos os tokens de acesso criptografados
          e o e-mail da conta conectada.
        </li>
      </ul>
      <p>
        O uso e a transferência de informações recebidas das APIs do Google seguem a{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
          Política de Dados do Usuário dos Serviços de API do Google
        </a>
        , incluindo os requisitos de Uso Limitado. Esses dados não são vendidos, não são usados para publicidade e
        não são compartilhados com terceiros, exceto quando necessário para prestar o serviço ou exigido por lei.
        Você pode desconectar sua conta Google a qualquer momento na tela de Agendamentos ou em{" "}
        <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">myaccount.google.com/permissions</a>.
      </p>

      <h2>4. Finalidades</h2>
      <ul>
        <li>Prestar o serviço de CRM: atendimento, agenda, funil de vendas e comunicação com contatos.</li>
        <li>Autenticar usuários e proteger as contas contra acessos indevidos.</li>
        <li>Cumprir obrigações legais e atender solicitações de autoridades competentes.</li>
      </ul>

      <h2>5. Compartilhamento</h2>
      <p>
        Os dados são armazenados em servidores contratados pela Kodexx. Integrações com serviços de terceiros
        (como WhatsApp, Instagram, e-mail ou Google) só são ativadas pela empresa cliente e recebem apenas o
        necessário para funcionar.
      </p>

      <h2>6. Segurança e retenção</h2>
      <p>
        Usamos conexão criptografada (HTTPS), senhas com hash, credenciais de integrações criptografadas e
        controle de acesso por perfil. Os dados são mantidos enquanto a empresa cliente usar o serviço ou
        conforme exigido por lei, e podem ser excluídos a pedido da empresa controladora.
      </p>

      <h2>7. Seus direitos</h2>
      <p>
        Você pode solicitar acesso, correção, portabilidade ou exclusão dos seus dados, bem como informações sobre
        o tratamento. Se você é contato ou paciente de uma empresa que usa o NovaCRM, dirija o pedido a essa
        empresa; também é possível nos escrever e encaminharemos a solicitação.
      </p>

      <h2>8. Contato</h2>
      <p>
        Dúvidas sobre esta política ou sobre seus dados: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>
    </LegalPage>
  );
}
