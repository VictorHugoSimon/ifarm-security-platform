# SEC-180 — Privacy & Retention Center

Data de referência: 2026-09-11.

## Objetivo
Criar uma camada operacional de Privacy/LGPD para registrar solicitações do titular e políticas internas de retenção, sem transformar o sistema em mecanismo de decisão jurídica ou exclusão automática.

> Este módulo não é parecer jurídico. Bases legais, prazos legais, retenção definitiva, exceções e respostas ao titular exigem validação de advogado/DPO responsável.

## Princípio fail-closed
SEC-180 **não apaga, anonimiza, exporta ou altera dados automaticamente**.

- `automated_deletion_enabled=false` é imposto por constraint nas políticas de retenção;
- `automated_execution_enabled=false` é imposto por constraint nas solicitações;
- pedido de exclusão pode ser recebido/analisado/aprovado, mas não pode ser marcado `fulfilled` enquanto não existir execução jurídica/técnica controlada;
- nenhum prazo legal é codificado ou presumido nesta fase.

## Relação com Evidence Vault
A governança de retenção não substitui o Evidence Vault.

Evidências já possuem `retained_until`, `retention_reason` e `legal_hold`. Qualquer futura execução de retenção/exclusão deverá verificar esses controles antes de qualquer ação. Legal hold prevalece sobre rotina operacional de retenção.

## Políticas de retenção
Tabela `data_retention_policies` por organização e classe de dados.

Classes iniciais:
- identidade/acesso;
- eventos de segurança;
- incidentes;
- evidências;
- gravações;
- telemetria;
- auditoria;
- suporte;
- ativos;
- Insurance;
- consentimentos;
- Community.

Status:
- `draft`;
- `approved`;
- `retired`.

Política aprovada exige `legal_review_reference`, `approved_by_user_id` e `approved_at`. O sistema registra a referência; ele não valida juridicamente o conteúdo.

## Solicitações de privacidade
Tipos:
- `access`;
- `correction`;
- `export`;
- `restriction`;
- `deletion`;
- `objection`.

Status:
- `received`;
- `under_review`;
- `approved`;
- `partially_approved`;
- `rejected`;
- `fulfilled`;
- `cancelled`.

Para `deletion`, `fulfilled` permanece bloqueado em SEC-180 por `privacy_deletion_execution_not_implemented`.

## Segurança e RBAC
Qualquer usuário autenticado com membership ativo pode abrir solicitação na própria organização; escopo de propriedade só é aceito quando o usuário realmente possui acesso à propriedade.

Gestão administrativa:
- Admin iFarm;
- Admin Organização da própria organização.

Admin Bairro, Owner, Família, Funcionário, Técnico e Monitoramento não recebem poder administrativo sobre solicitações da organização apenas pelo papel.

As tabelas-base não têm acesso direto do browser. A superfície é exclusivamente RPC `SECURITY DEFINER` com checagem server-side.

## RPCs
- `set_data_retention_policy`
- `list_data_retention_policies`
- `create_my_privacy_request`
- `list_my_privacy_requests`
- `list_managed_privacy_requests`
- `update_privacy_request_status`
- `cancel_my_privacy_request`
- `get_privacy_request_timeline`

Helper interno:
- `app_can_manage_privacy_org`

## UI
Rota `#/privacy`:
- nova solicitação;
- minhas solicitações;
- cancelamento enquanto elegível;
- políticas visíveis de retenção;
- administração de políticas;
- fila de governança para perfis autorizados;
- alerta explícito de que exclusão automática está desligada.

## Auditoria
Eventos globais:
- `privacy.retention_policy.updated`;
- `privacy.request.created`;
- `privacy.request.status_changed`.

Timeline própria registra criação, mudança de status e cancelamento.

## Validação DEV/STAGE — 2026-09-11

### DEV
- migration `0023_privacy_retention.sql` aplicada em uma única transação;
- 3 tabelas presentes e 3 com RLS;
- `authenticated` sem SELECT/INSERT direto em `privacy_requests`;
- `authenticated` executa RPC autorizada; `anonymous` não;
- constraints `retention_no_automatic_deletion` e `privacy_no_automatic_execution` presentes;
- corpo de `update_privacy_request_status` confirmado com `privacy_deletion_execution_not_implemented` e `automated_execution_enabled=false`.

### STAGE
- mesma migration `0023` aplicada em uma única transação;
- 3 tabelas com RLS; browser sem acesso direto; RPC administrativa indisponível para `anonymous`;
- Admin Organização tentou aprovar política sem referência jurídica/DPO e recebeu `legal_review_reference_required`;
- com referência `QA-DPO-SEC180`, política de evidências foi aprovada mantendo `automated_deletion_enabled=false` e `legal_review_required=true`;
- Owner Fazenda A abriu pedido `deletion` na própria Fazenda A e o pedido ficou `automated_execution_enabled=false`;
- Owner Fazenda A tentou abrir solicitação na Fazenda B e recebeu `privacy_property_access_denied`;
- Admin Bairro recebeu 0 solicitações gerenciáveis do pedido privado;
- Admin Organização visualizou o pedido e recebeu `deletion_execution_supported=false` + `legal_hold_review_required=true`;
- Admin Organização alterou `received → under_review → approved` com registro de resposta/referência;
- tentativa de `approved → fulfilled` no pedido de exclusão foi bloqueada por `privacy_deletion_execution_not_implemented`;
- Família Fazenda A abriu pedido próprio de acesso; Owner Fazenda A continuou vendo apenas sua própria solicitação (`family_leak=0`);
- Família cancelou a própria solicitação elegível com sucesso;
- fixtures SEC-180 foram removidos ao final: 0 solicitações, 0 políticas e 0 logs sintéticos restantes.

### PROD
- nenhuma migration SEC-180 aplicada;
- PROD permanece fora desta fase.

## Critérios de aceite
1. nenhuma tabela de privacy/retention acessível diretamente pelo browser;
2. `anonymous` não executa RPCs;
3. usuário só abre solicitação em organização/propriedade onde possui acesso;
4. usuário visualiza apenas as próprias solicitações;
5. Admin Organização visualiza/gerencia apenas sua organização;
6. retenção aprovada exige referência de revisão jurídica/DPO;
7. `automated_deletion_enabled` permanece sempre false;
8. `automated_execution_enabled` permanece sempre false;
9. pedido `deletion` não pode ser `fulfilled` nesta fase;
10. Evidence Vault/legal hold não é contornado;
11. nenhum prazo legal é hardcoded;
12. DEV → STAGE; PROD permanece intocado.
