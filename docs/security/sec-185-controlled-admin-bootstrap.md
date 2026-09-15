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

## QA
Antes de promover a migration:
- DEV primeiro;
- confirmar que `authenticated` não executa o finalizador;
- confirmar que um usuário sintético `admin_ifarm` com `emailVerified=false` continua retornando `app_is_platform_admin() = false`;
- reverter imediatamente qualquer papel sintético usado no teste para `user`;
- repetir em STAGE;
- PROD permanece intocado.

## Primeiro Admin real
Não criar o primeiro Admin iFarm real até existir uma identidade real explicitamente escolhida e verificada. Não inferir e-mail pessoal, não reutilizar usuário de outro projeto e não promover usuário QA.
