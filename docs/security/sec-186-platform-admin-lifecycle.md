# SEC-186 — Platform Admin Lifecycle & Recovery

Data de referência: 2026-09-15.

## Objetivo
Garantir continuidade administrativa depois do primeiro `Admin iFarm`, sem transformar o portal em um painel capaz de criar ou remover superadministradores.

## Autoridade em duas camadas
Um usuário só é `Admin iFarm` efetivo quando **todas** as condições forem verdadeiras:
1. Neon Auth: `role = 'admin_ifarm'`;
2. Neon Auth: `emailVerified = true`;
3. Neon Auth: `banned = false`;
4. o último evento auditado da identidade for `platform_admin.bootstrap.completed` ou `platform_admin.promoted`.

Portanto, atribuir apenas o papel no Neon Auth não libera autoridade global no banco. A mudança só entra em vigor após a finalização/auditoria owner-only.

## Promoção de administrador adicional
Fluxo operacional:
1. confirmar que o primeiro bootstrap SEC-185 já foi concluído;
2. validar a identidade-alvo e o e-mail esperado;
3. promover a identidade pelo **control plane oficial do Neon Auth**;
4. executar como owner:
   `SELECT public.app_finalize_platform_admin_change('promote', '<auth-user-id>', '<expected-email>', '<reason>');`
5. o finalizador exige que exista pelo menos um Admin iFarm auditado-ativo diferente do alvo;
6. o evento `platform_admin.promoted` é gravado;
7. somente a partir desse evento `app_is_platform_admin()` passa a considerar o novo administrador ativo.

## Revogação
A revogação exige duas fases de banco ao redor da mudança no Neon Auth.

### Antes da mudança
Executar como owner:
`SELECT * FROM public.app_platform_admin_revoke_preflight('<auth-user-id>', '<expected-email>');`

O preflight exige:
- alvo atualmente auditado-ativo;
- identidade/e-mail correspondentes;
- existência de pelo menos **outro** Admin iFarm auditado-ativo.

Se o alvo for o último administrador elegível, retorna `last_platform_admin_revoke_forbidden`.

### Control plane
Depois do preflight aprovado, remover `admin_ifarm` pelo MCP/CLI/API oficial do Neon Auth. O banco nunca altera `neon_auth.user` diretamente.

### Depois da mudança
Executar como owner:
`SELECT public.app_finalize_platform_admin_change('revoke', '<auth-user-id>', '<expected-email>', '<reason>');`

O finalizador exige:
- papel/estado externo já não elegível como Admin iFarm;
- pelo menos um outro administrador auditado-ativo restante;
- último estado auditado anterior do alvo como `bootstrap.completed` ou `promoted`;
- registro `app_user` existente.

Em seguida grava `platform_admin.revoked`.

## Recuperação
A regra operacional é manter pelo menos dois administradores auditados-ativos antes de iniciar a revogação de qualquer um deles. O sistema não oferece bypass de emergência pelo browser.

Se todas as identidades administrativas forem perdidas fora do fluxo controlado, a recuperação exige operação administrativa no control plane do Neon/DB owner e revisão de incidente. Não criar backdoor permanente, senha mestra, role hardcoded ou endpoint público de recuperação.

## Superfícies proibidas
- botão frontend para promover `admin_ifarm`;
- RPC executável por `authenticated` para promover/revogar;
- convite tenant para `admin_ifarm`;
- alteração SQL direta de `neon_auth.user` pelas migrations da aplicação;
- considerar somente `role=admin_ifarm` suficiente;
- remover o último administrador auditado-ativo.

## Auditoria
Eventos:
- `platform_admin.bootstrap.completed` — primeiro Admin iFarm (SEC-185);
- `platform_admin.promoted` — administradores adicionais;
- `platform_admin.revoked` — revogações.

Os eventos guardam `auth_user_id`, motivo e contagens de continuidade. Não gravar senha, token ou credencial.

## MFA
Permanece requisito do produto, mas não é declarado implementado enquanto o Managed Better Auth não oferecer MFA de usuário final. `mfa_provider_support='pending'` permanece explícito nos eventos.

## QA executado
### DEV
- migration `0027_platform_admin_lifecycle.sql` aplicada após CI verde;
- `authenticated` executa apenas `app_is_platform_admin()`;
- `authenticated` não executa `app_platform_admin_identity_is_active`, preflight ou finalizador;
- `anonymous` não executa `app_is_platform_admin()`;
- sem sessão, autoridade de plataforma = `false`;
- não existe `platform_admin.bootstrap.completed`;
- preflight owner-only retorna `platform_admin_bootstrap_required`, como esperado.

### STAGE
- mesma migration aplicada após DEV;
- avaliador interno, preflight e finalizador confirmados owner-only;
- identidade QA `c439ec17-9720-45b0-a1b1-1fe5baf38083` retorna `app_platform_admin_identity_is_active=false`;
- sob JWT QA autenticado, `app_is_platform_admin()=false`;
- `bootstrap_rows=0`;
- preflight recusa operação com `platform_admin_bootstrap_required`.

Não foi criado, promovido ou revogado nenhum Admin iFarm real durante a SEC-186.

## Teste positivo pendente
O teste positivo completo de promoção → autoridade auditada → preflight → revogação exige o primeiro bootstrap real da SEC-185. Até existir uma identidade real explicitamente escolhida e verificada, criar um estado sintético positivo mascararia justamente a proteção que esta feature pretende garantir. O teste positivo fica como critério obrigatório do primeiro onboarding administrativo controlado.

## PROD
PROD permanece intocado nesta fase.
