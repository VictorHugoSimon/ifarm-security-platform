# SEC-185 — Controlled Admin Bootstrap

Data de referência: 2026-09-15.

## Objetivo
Criar o primeiro `Admin iFarm` sem expor promoção administrativa no portal, sem aceitar `admin_ifarm` pelo fluxo de convites tenant e sem editar tabelas internas do Managed Better Auth.

## Autoridade
A autoridade de `Admin iFarm` é o diretório oficial Neon Auth:
- `neon_auth.user.role = 'admin_ifarm'`;
- `emailVerified = true`;
- `banned = false`.

A função `app_is_platform_admin()` aplica os três requisitos no banco. A UI também bloqueia qualquer sessão cujo e-mail não esteja verificado, mas a UI não é a autoridade de segurança.

## Regra crítica
O portal **não** oferece botão, RPC ou endpoint para promover `admin_ifarm`.

`create_access_invitation()` continua rejeitando `admin_ifarm` com `invitation_role_requires_separate_onboarding`.

## Procedimento do primeiro administrador
1. Criar/identificar a identidade exclusivamente no Neon Auth da branch correta.
2. Confirmar, antes da promoção:
   - `auth_user_id` exato;
   - e-mail esperado;
   - `emailVerified=true`;
   - `banned=false`.
3. Promover **somente pelo control plane oficial do Neon Auth** (MCP/CLI/API) para `admin_ifarm`.
4. O usuário entra normalmente pelo portal. `AuthGate` bloqueia qualquer identidade não verificada.
5. No primeiro fluxo administrativo que exigir materialização do usuário, `app_ensure_platform_user()`:
   - revalida `app_is_platform_admin()`;
   - verifica o e-mail novamente;
   - cria/atualiza `app_users` com `mfa_required=true`.
6. `create_organization()` já chama `app_ensure_platform_user()` antes de criar o primeiro tenant e registra a criação no audit log.

Não existe função especial de bootstrap executável pelo browser e não existe `admin_ifarm` por convite.

## Migration 0026
`0026_controlled_admin_bootstrap.sql` endurece `app_is_platform_admin()` para exigir, simultaneamente:
- role `admin_ifarm` no Neon Auth;
- e-mail verificado;
- identidade não banida.

Permissões do helper:
- `PUBLIC`: revogado;
- `anonymous`: revogado;
- `authenticated`: EXECUTE apenas para avaliar a sessão autenticada.

## MFA
`app_users.mfa_required=true` permanece como requisito de produto. Em 2026-09-15, MFA para usuários finais continua indisponível no Managed Better Auth segundo o roadmap oficial registrado na SEC-184. Isso é bloqueio de produção e não deve ser apresentado como implementado.

## QA planejado
### DEV
- aplicar `0026`;
- confirmar `authenticated=true` e `anonymous=false` para EXECUTE em `app_is_platform_admin()`;
- confirmar sem sessão `app_is_platform_admin() = false`;
- confirmar zero `admin_ifarm` elegíveis.

### STAGE
- aplicar a mesma migration após DEV;
- usar apenas um usuário QA sintético existente;
- promover temporariamente esse QA para `admin_ifarm` pelo control plane oficial;
- manter `emailVerified=false`;
- provar que `app_is_platform_admin() = false` mesmo com o papel;
- restaurar imediatamente o papel para `user`;
- confirmar zero admins elegíveis ao final e nenhuma alteração de tenant/membership.

O teste negativo comprova que possuir somente o papel `admin_ifarm` não é suficiente para obter autoridade de plataforma.

## Primeiro Admin real
Não criar o primeiro Admin iFarm real até existir uma identidade real explicitamente escolhida e verificada. Não inferir e-mail pessoal, não reutilizar usuário de outro projeto e não promover usuário QA.

## PROD
PROD não recebe a migration nesta fase e permanece fora do bootstrap até o gate formal de promoção.
