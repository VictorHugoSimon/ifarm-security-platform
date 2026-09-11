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

## Critérios de aceite
1. `authenticated` perde SELECT direto em `audit_logs`;
2. `anonymous` não executa a RPC;
3. Admin Organização visualiza eventos da organização;
4. Admin Bairro não visualiza evento de propriedade privada;
5. Owner Fazenda A não visualiza Fazenda B;
6. Família/Técnico/Monitoramento recebem zero eventos;
7. aceite de convite gera `access.invitation.accepted`;
8. UI não recebe/renderiza `details`, e-mail, IP, request id ou hash de e-mail;
9. limite server-side fica entre 1 e 500 registros;
10. aplicar DEV primeiro, depois STAGE. PROD permanece intocado.
