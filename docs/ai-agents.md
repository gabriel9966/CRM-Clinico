# Agentes de IA (chatbot) nas automações

Tela: **Agentes de IA** (menu, só administradores). Uso: gatilho **Mensagem recebida** → ação
**Agente de IA (chatbot)**. O agente lê a conversa e responde pelo **mesmo canal** (WhatsApp,
Instagram ou e-mail) da mensagem recebida.

## Como funciona

1. A automação dispara quando chega uma mensagem do cliente (roda em segundo plano para o webhook do
   canal responder na hora).
2. `respondWithAgent` (`src/lib/ai/agent.ts`) confere: agente ativo, IA não pausada na conversa,
   limite de respostas/hora por cliente e limite diário de tokens.
3. Monta o histórico (só desta conversa; **notas privadas nunca vão para a IA**) e chama a API da
   Anthropic (SDK oficial) num laço de ferramentas (`src/lib/ai/loop.ts`).
4. Antes de enviar, confere se nada mudou: se um atendente respondeu ou chegou mensagem nova, a
   resposta é descartada (e refeita, no segundo caso).
5. Envia por `sendContactMessage` e registra o uso (`AiUsage`).

## Segurança e boas práticas

- **Chave própria da empresa**, criptografada (AES-256-GCM, mesma proteção das conexões); só os 4
  últimos caracteres voltam à tela. Nunca vai para logs nem para o histórico de erros.
- **Mensagem do cliente = dado não confiável.** O prompt do sistema traz regras fixas que o texto do
  cliente não consegue mudar; as ferramentas **nunca recebem o id do contato do modelo**: ele vem
  sempre da conversa. Agendamentos de outro cliente são recusados (testado).
- **Ferramentas mínimas:** só as liberadas no agente existem. As que alteram dados têm limite por
  resposta (ex.: 2 agendamentos, 1 cancelamento) e passam pelas regras normais da agenda.
- **Passar para humano** (`handoff_to_human`) está sempre ligada. Em dúvida clínica, reclamação,
  recusa do modelo, erro da API ou limite estourado, a IA pausa na conversa, abre tarefa para a equipe
  e avisa o cliente uma vez. Um atendente que responde pelo CRM também pausa a IA automaticamente.
  “Retomar IA” (cabeçalho da conversa) libera de novo.
- **Freios de custo:** respostas por hora por cliente (evita laço bot × bot), limite diário de tokens,
  máximo de passos por resposta, `max_tokens` fixo e tempo limite de 60 s.
- **Playground** (“Testar conversa”): roda o agente de verdade, mas sem enviar mensagem e sem gravar
  agenda/ficha/tarefas.
- **Auditoria:** criar, editar e excluir agentes entram em Auditoria (sem a chave).
- **Privacidade:** o texto da conversa é enviado à Anthropic. Informe na política de privacidade (LGPD).

## Modelos

Padrão `claude-opus-5-5`; opções `claude-sonnet-5-5` (menor custo) e `claude-haiku-5-5` (mais
rápido/barato). Opus 5.5 e Sonnet 5.5 usam o fallback server-side da Anthropic em recusas.
Raciocínio do Opus 5.5 é sempre ligado (não há configuração); o controle é o “esforço”.

## Outras IAs

Agentes externos (n8n, Claude Desktop, GPT…) usam a **Integração MCP** (`/api/mcp`) ou o gatilho
“Webhook recebido”. O provedor nativo é só a Anthropic; a interface `MessagesApi`
(`src/lib/ai/loop.ts`) é o ponto onde outro provedor entraria.
