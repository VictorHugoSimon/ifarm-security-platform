# SEC-179 — Suporte e manutenção operacional

Data de referência: 2026-09-11.

## Objetivo
Adicionar uma central de suporte vendável ao iFarm Security para registrar falhas de dispositivo, câmera, sensor, gateway, conectividade, aplicativo, acesso, Insurance ou outras ocorrências técnicas.

## Escopo
Um chamado pertence sempre a uma Organização e pode estar vinculado a:
- bairro comunitário;
- propriedade privada;
- dispositivo específico.

Se o dispositivo for informado, o backend herda/valida organização, bairro e propriedade do próprio cadastro do equipamento.

## Severidade
Reutiliza o padrão do produto:
- `informational`;
- `attention`;
- `high`;
- `critical`.

## Status
- `open`;
- `triaged`;
- `in_progress`;
- `waiting_customer`;
- `resolved`;
- `closed`.

`closed` é terminal nesta superfície.

## Metas operacionais
`support_operational_targets` permite configurar alvo de resposta e resolução por organização + severidade.

Regra crítica: essas metas **não são SLA contratual**. No MVP:
- coluna `contractual` tem default `false`;
- constraint exige `contractual = false`;
- RPC de configuração sempre grava `false`;
- UI exibe explicitamente que a meta é operacional;
- se não houver meta configurada, o ticket fica sem prazo em vez de inventar um compromisso.

Um SLA contratual futuro deve depender de plano/contrato comercial aprovado, com escopo, horário de cobertura, exceções e responsabilidade definidos.

## Segurança e RBAC
Criar chamado: qualquer usuário autenticado com acesso ao escopo.

Gerenciar status:
- Admin iFarm;
- Admin Organização na organização;
- Admin Bairro somente em chamados comunitários do próprio bairro;
- Técnico comunitário no próprio bairro;
- Proprietário e Técnico apenas na própria propriedade.

Família, Funcionário e Monitoramento podem abrir/acompanhar chamados conforme acesso, mas não recebem gestão por esta superfície apenas pelo papel.

As tabelas `support_operational_targets`, `support_tickets` e `support_ticket_actions` não recebem acesso direto de browser. Toda operação usa RPC `SECURITY DEFINER` com validação server-side.

## RPCs
- `set_support_operational_target`
- `create_support_ticket`
- `update_support_ticket_status`
- `add_support_ticket_note`
- `assign_support_ticket`
- `list_support_tickets`
- `get_support_ticket_timeline`

Helper interno:
- `app_can_manage_support_scope`

## Timeline e auditoria
`support_ticket_actions` registra abertura, snapshot de meta, notas, mudança de status e atribuição.

Audit log global registra:
- `support.target.updated`;
- `support.ticket.created`;
- `support.ticket.status_changed`.

## UI
Rota `#/support`:
- abertura de chamado;
- seleção de escopo/dispositivo;
- severidade/categoria;
- fila ordenada por severidade;
- indicadores de meta vencida;
- atualização de status;
- configuração de meta operacional por Admin autorizado.

## Princípios
- não presume atendimento humano 24x7;
- não presume integração/despacho de autoridade pública;
- não promete impedir crimes;
- meta operacional não é garantia ou SLA contratual;
- suporte contratado/faturado deverá ser definido por plano comercial e contrato.

## Validação DEV/STAGE — 2026-09-11

### DEV
- migration `0022_support_maintenance.sql` aplicada transacionalmente;
- 3 tabelas de suporte presentes e com RLS habilitado;
- `authenticated` sem `SELECT` ou `INSERT` direto em `support_tickets`;
- `authenticated` executa as RPCs autorizadas e `anonymous` não;
- constraint `support_target_non_contractual` presente.

### STAGE
- mesma migration `0022` aplicada transacionalmente;
- 3 tabelas com RLS e sem acesso direto do browser;
- Admin Organização configurou meta `high` de 30 min resposta / 240 min resolução com `contractual=false`;
- Owner Fazenda A abriu ticket na câmera privada A e recebeu snapshot das metas;
- Owner Fazenda A visualizou 1 ticket privado; Admin Bairro visualizou 0 desse ticket;
- Família Fazenda A visualizou o ticket privado; Monitoramento Fazenda A visualizou o ticket privado; Técnico apenas de bairro visualizou 0 do ticket privado;
- tentativa de Owner Fazenda A abrir ticket na câmera privada da Fazenda B retornou `support_scope_access_denied` e não criou registro;
- Admin Bairro abriu ticket comunitário, atribuiu ao Técnico do bairro e o Técnico atualizou para `in_progress`;
- Owner Fazenda A atualizou seu ticket privado para `triaged`;
- fixtures sintéticos SEC-179 foram removidos ao final: 0 tickets, 0 metas e 0 logs sintéticos restantes.

### PROD
- nenhuma migration SEC-179 aplicada;
- PROD permanece fora desta fase.

## Aceite
1. zero acesso direto às tabelas de suporte pelo browser;
2. `anonymous` não executa RPCs;
3. ticket herda escopo do dispositivo quando informado;
4. Admin Bairro não gerencia chamado privado;
5. Owner/Técnico não atravessam propriedades;
6. `closed` é terminal;
7. target contratual não pode virar `true` no MVP;
8. sem target configurado, datas-alvo ficam `NULL`;
9. fila calcula atraso apenas quando existe target;
10. DEV primeiro, depois STAGE. PROD permanece intocado.
