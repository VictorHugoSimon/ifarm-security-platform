# SEC-176 — Ciclo de vida de acessos ativos

Data de referência: 2026-09-11.

## Objetivo
Permitir suspender, reativar e revogar memberships tenant sem delete, mantendo escopo, auditoria e separação entre área comunitária e propriedade privada.

## Estados
- `active`: acesso válido para RBAC/RLS;
- `suspended`: acesso temporariamente bloqueado e reativável por gestor autorizado;
- `revoked`: acesso encerrado de forma terminal nesta superfície.

Revogar ou suspender um membership remove imediatamente aquele escopo porque os helpers de acesso consideram apenas memberships com `status = 'active'`.

## Papéis gerenciáveis
- `admin_organization` — somente Admin iFarm;
- `admin_neighborhood` — Admin Organização ou Admin iFarm;
- `owner` — Admin Organização ou Admin iFarm;
- `family`, `employee`, `technician`, `monitoring` — conforme organização/bairro/propriedade e hierarquia.

Ficam fora da superfície genérica:
- `admin_ifarm`;
- `authorized_authority`;
- `insurance_partner`.

## Regras de delegação
- Admin Organização administra papéis inferiores dentro da própria organização, mas não outro Admin Organização;
- Admin Bairro administra apenas `technician` e `monitoring` comunitários do próprio bairro, nunca propriedade privada;
- Proprietário administra `family`, `employee`, `technician` e `monitoring` apenas na própria propriedade;
- Família, Funcionário, Técnico e Monitoramento não administram memberships;
- o ator não administra o próprio membership por esta superfície;
- `revoked` é terminal e não pode voltar a `active`/`suspended`.

## Dados e auditoria
`memberships` recebe:
- `status_changed_at`;
- `status_changed_by_user_id`;
- `status_reason` (máx. 500 caracteres).

Suspensão e revogação exigem motivo. Reativação aceita motivo opcional.

Audit actions:
- `access.membership.suspended`;
- `access.membership.reactivated`;
- `access.membership.revoked`.

## Superfície de browser
A tabela `memberships` não fica exposta diretamente a `PUBLIC`, `anonymous` ou `authenticated`.

RPCs autenticadas:
- `list_managed_memberships`;
- `set_membership_status`.

Helper interno:
- `app_can_manage_membership` — sem grant de execução para browser roles.

## UI
`MembershipManagement.tsx` lista apenas memberships gerenciáveis pelo ator e oferece ações coerentes com o status atual. A autorização final e as transições são sempre decididas pelo banco.

## Evidência DEV → STAGE
A migration `0020_membership_lifecycle.sql` foi aplicada primeiro em DEV e depois em STAGE. PROD permaneceu intocado.

DEV pós-migration:
- 3/3 novas colunas presentes (`status_changed_at`, `status_changed_by_user_id`, `status_reason`);
- 2/2 constraints de lifecycle presentes;
- 3/3 funções principais confirmadas como `SECURITY DEFINER`;
- `authenticated` executa `list_managed_memberships` e `set_membership_status`;
- `anonymous` não executa a RPC de alteração;
- `authenticated` e `anonymous` permanecem sem acesso direto à tabela `memberships`.

STAGE pós-migration repetiu os mesmos invariantes. A matriz sintética SEC-150, com uma identidade/JWT por transação, retornou:
- Admin Organização: **5** memberships gerenciáveis — Admin Bairro, Owner, Família, Técnico e Monitoramento; o próprio Admin Organização não é gerenciável por ele;
- Admin Bairro: **1** membership gerenciável — Técnico comunitário; nenhum acesso privado;
- Owner Fazenda A: **2** memberships gerenciáveis — Família e Monitoramento da Fazenda A;
- Família Fazenda A: **0**;
- Técnico comunitário: **0**;
- Monitoramento Fazenda A: **0**.

Uma primeira chamada de listagem feita imediatamente após criar as funções retornou temporariamente zero para Admin Organização. A investigação confirmou: helper = 5 gerenciáveis, RLS sem FORCE, ownership correto, JWT e `app_current_user_id()` corretos dentro de `SECURITY DEFINER`, e uma réplica da consulta retornou 6 linhas totais / 5 gerenciáveis. A RPC real foi repetida e retornou consistentemente os 5 esperados. As funções temporárias de diagnóstico foram removidas na própria transação; ao final havia **0** funções `_sec176_debug%`.

## Smoke real de suspensão e reativação
Foi utilizado apenas o fixture sintético existente `Family Fazenda A`, administrado pelo `Owner Fazenda A`:
1. Owner A executou `set_membership_status(..., 'suspended', 'SEC-176 smoke suspensão temporária')` com role `authenticated`;
2. com JWT da Família A, `app_has_scope_access` para Fazenda A passou a **false** e `organizations` retornou **0** linhas visíveis;
3. Owner A executou `set_membership_status(..., 'active', 'SEC-176 smoke reativação após validação')`;
4. com JWT da Família A, `app_has_scope_access` voltou a **true** e `organizations` voltou a **1** linha visível;
5. o fixture terminou novamente `active`.

A trilha de auditoria registrou as duas transições com `from_status`, `to_status`, motivo e horário:
- `access.membership.suspended`: `active → suspended`;
- `access.membership.reactivated`: `suspended → active`.

O teste negativo com motivo `NULL` foi bloqueado pela camada de segurança da ferramenta antes de chegar ao banco, portanto não alterou dados. A exigência de motivo foi validada pelo gate estático e pelo corpo da função no STAGE. O corpo live de `set_membership_status` também confirma `membership_revoked_terminal`, impedindo reativação após revogação. Não foi revogado um fixture QA real apenas para produzir uma falha terminal destrutiva.

Estado final do STAGE após smoke:
- memberships ativos: **6**;
- suspensos: **0**;
- revogados: **0**;
- funções temporárias de debug: **0**.

## Aceite
1. Admin Organização visualiza/gerencia Owner/Admin Bairro e papéis inferiores, mas não outro Admin Organização — **validado**;
2. Admin Bairro gerencia somente Técnico/Monitoramento comunitário e não acesso privado — **validado pela matriz**;
3. Owner Fazenda A gerencia apenas papéis operacionais da Fazenda A — **validado**;
4. Família/Técnico/Monitoramento não recebem memberships gerenciáveis — **validado**;
5. revogação é terminal — **validado por invariantes e função live**;
6. suspensão bloqueia imediatamente o acesso e reativação restaura — **validado end-to-end**;
7. `anonymous` não executa RPC de alteração — **validado**;
8. tabela possui zero grants diretos para browser — **validado**;
9. auditoria registra transições — **validado**;
10. DEV → STAGE concluído. PROD permanece intocado.
