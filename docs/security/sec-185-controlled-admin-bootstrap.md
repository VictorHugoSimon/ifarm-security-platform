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
   - e-mail esperado exato;
   - `emailVerified=true`;
   - `banned=false`.
3. Confirmar que ainda não existe outro usuário verificado e não banido com papel `admin_ifarm`.
4. Promover **somente pelo control plane oficial do Neon Auth** (MCP/CLI/API), por exemplo:
   `neon neon-auth user set-role <auth-user-id> --roles admin_ifarm --branch <branch> --project-id restless-cell-49791922`
5. Executar, como proprietário do banco e nunca como papel do portal:
   `SELECT public.app_finalize_first_platform_admin_bootstrap('<auth-user-id>', '<expected-email>', '<reason>');`
6. Validar o evento `platform_admin.bootstrap.completed` no `audit_logs`.
7. Validar login, `app_is_platform_admin()` e navegação de Admin iFarm.

## Finalizador owner-only
`app_finalize_first_platform_admin_bootstrap()` **não concede** o papel `admin_ifarm`. Ele somente:
- vincula o `auth_user_id` ao e-mail esperado;
- exige e-mail verificado;
- exige identidade não banida;
- exige que o papel já tenha sido concedido no Neon Auth;
- exige que exista exatamente um primeiro Admin iFarm elegível;
- cria/ativa o registro em `app_users`;
- grava o evento de auditoria;
- impede segunda finalização após o bootstrap registrado.

Permissões:
- `PUBLIC`: sem EXECUTE;
- `anonymous`: sem EXECUTE;
- `authenticated`: sem EXECUTE;
- uso exclusivo do owner/control plane operacional.

## MFA
`app_users.mfa_required=true` permanece como requisito de produto. Em 2026-09-15, MFA para usuários finais continua indisponível no Managed Better Auth segundo o roadmap oficial já registrado na SEC-184. Isso é bloqueio de produção e não deve ser apresentado como implementado.

## QA executado
### DEV
- migration `0026_controlled_admin_bootstrap.sql` aplicada;
- `authenticated` executa `app_is_platform_admin()`;
- `anonymous` não executa `app_is_platform_admin()`;
- `authenticated` e `anonymous` não executam o finalizador;
- sem sessão, `app_is_platform_admin() = false`;
- `admin_ifarm_total = 0` e `eligible_admin_ifarm = 0`.

### STAGE
- mesma migration aplicada após DEV;
- privilégios do finalizador confirmados como owner-only;
- usuário QA `qa-admin-org@ifarm-security.test` recebeu temporariamente `admin_ifarm` via control plane oficial;
- esse usuário permaneceu com `emailVerified=false`;
- sob JWT QA autenticado, `app_is_platform_admin() = false`;
- o finalizador rejeitou a identidade com `verified_email_required`;
- o papel foi imediatamente restaurado para `user`;
- estado final: `admin_ifarm_total = 0`, `eligible_admin_ifarm = 0`, `bootstrap_audit_rows = 0`.

O teste comprova que possuir apenas o papel `admin_ifarm` não é suficiente para obter autoridade de plataforma.

## Primeiro Admin real
Não criar o primeiro Admin iFarm real até existir uma identidade real explicitamente escolhida e verificada. Não inferir e-mail pessoal, não reutilizar usuário de outro projeto e não promover usuário QA.

## PROD
PROD não recebe a migration nesta fase e permanece fora do bootstrap até o gate formal de promoção.
