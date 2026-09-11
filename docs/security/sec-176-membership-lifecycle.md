# SEC-176 — Ciclo de vida de acessos ativos

Data de referência: 2026-09-11.

## Objetivo
Permitir suspender, reativar e revogar memberships tenant sem delete, mantendo escopo, auditoria e separação entre área comunitária e propriedade privada.

## Estados
- `active`: acesso válido para RBAC/RLS;
- `suspended`: acesso temporariamente bloqueado e reativável por gestor autorizado;
- `revoked`: acesso encerrado de forma terminal nesta superfície.

Revogar um membership remove imediatamente aquele escopo porque os helpers de acesso consideram apenas memberships com `status = 'active'`.

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

## Aceite planejado
1. Admin Organização visualiza/gerencia Owner/Admin Bairro e papéis inferiores, mas não outro Admin Organização;
2. Admin Bairro consegue suspender Técnico/Monitoramento comunitário e não consegue tocar acesso privado;
3. Owner Fazenda A consegue suspender/revogar Família/Técnico da Fazenda A e não da Fazenda B;
4. Família/Técnico/Monitoramento não recebem memberships gerenciáveis;
5. revogação é terminal;
6. suspensão exige motivo e reativação restaura acesso;
7. `anonymous` não executa RPCs;
8. tabela possui zero grants diretos para browser;
9. auditoria registra cada transição;
10. DEV primeiro, depois STAGE. PROD permanece intocado.
