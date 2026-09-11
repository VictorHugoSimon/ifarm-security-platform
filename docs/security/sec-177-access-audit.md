# SEC-177 — Auditoria sanitizada de acessos

Data de referência: 2026-09-11.

## Objetivo
Expor uma trilha auditável de mudanças de acesso sem liberar a tabela `audit_logs` ao browser e sem misturar escopo comunitário com propriedade privada.

## Eventos cobertos
- `access.invitation.created`
- `access.invitation.accepted`
- `access.invitation.revoked`
- `access.membership.suspended`
- `access.membership.reactivated`
- `access.membership.revoked`

O aceite de convite passa a ser registrado por trigger quando `access_invitations.status` muda de `pending` para `accepted`.

## Escopo de visualização
- Admin iFarm: visão da plataforma conforme escopo da RPC;
- Admin Organização: eventos de acesso da própria organização;
- Admin Bairro: somente eventos comunitários do próprio bairro, com `property_id IS NULL`;
- Proprietário: somente eventos de acesso vinculados à própria propriedade;
- Família, Funcionário, Técnico e Monitoramento: sem acesso ao centro de auditoria genérico;
- Autoridade Autorizada e Parceiro de Seguro: fora desta superfície e sujeitos a onboarding/finalidade específicos.

## Sanitização
A RPC `list_access_audit_events` pode retornar somente:
- organização/bairro/propriedade autorizados;
- nome do ator;
- ação;
- tipo/id da entidade;
- papel alvo;
- transição de status;
- motivo operacional;
- data/hora.

Não retorna:
- `details` bruto;
- e-mail ou hash de e-mail de convite;
- IP/hash de IP;
- request id;
- token/JWT;
- payload de autenticação.

## Privilégios
`PUBLIC`, `anonymous` e `authenticated` ficam sem acesso direto a `public.audit_logs`.

Somente `authenticated` recebe `EXECUTE` na RPC sanitizada `list_access_audit_events(uuid,integer)`.

O helper `app_can_view_access_audit` e a função de trigger não são RPCs públicas para o browser.

## UI
`AccessAuditCenter.tsx` usa exclusivamente `neon.rpc('list_access_audit_events', ...)` e nunca consulta `audit_logs` diretamente.

## Evidência DEV / STAGE
A migration `0021_access_audit_center.sql` foi aplicada primeiro no DEV e depois no STAGE.

DEV:
- `authenticated` SELECT direto em `audit_logs`: `false`;
- `anonymous` SELECT direto em `audit_logs`: `false`;
- `authenticated` EXECUTE em `list_access_audit_events`: `true`;
- `anonymous` EXECUTE na RPC: `false`;
- trigger `trg_access_invitation_accepted_audit`: 1;
- sem sessão: 0 eventos visíveis.

STAGE:
- os mesmos grants/trigger foram confirmados;
- Admin Organização: 3 eventos no cenário de teste (2 privados existentes + 1 comunitário sintético temporário);
- Admin Bairro: 1 evento comunitário e nenhum evento privado;
- Owner Fazenda A: 2 eventos privados da Fazenda A e nenhum comunitário;
- Família Fazenda A: 0 eventos;
- Técnico comunitário: 0 eventos;
- Monitoramento Fazenda A: 0 eventos;
- trigger de aceite: 1 `access.invitation.accepted` gerado, com ator `50000000-0000-4000-8000-000000000003` (Owner QA Fazenda A);
- fixtures temporários de auditoria/convite foram removidos ao final: 0 remanescentes.

## Critérios de aceite
1. `authenticated` perde SELECT direto em `audit_logs` — validado;
2. `anonymous` não executa a RPC — validado;
3. Admin Organização visualiza eventos da organização — validado;
4. Admin Bairro não visualiza evento de propriedade privada — validado;
5. Owner Fazenda A não visualiza eventos fora da própria propriedade — validado;
6. Família/Técnico/Monitoramento recebem zero eventos — validado;
7. aceite de convite gera `access.invitation.accepted` — validado;
8. UI não recebe/renderiza `details`, e-mail, IP, request id ou hash de e-mail — gate CI;
9. limite server-side fica entre 1 e 500 registros — implementado;
10. DEV primeiro, depois STAGE; PROD permanece intocado — validado.
