# SEC-182 — Access-Aware Navigation

Data de referência: 2026-09-14.

## Objetivo
Reduzir a superfície visual do portal exibindo somente módulos compatíveis com os acessos ativos da sessão.

Esta camada é UX/minimização de superfície. Ela **não substitui** RLS, RPCs ou validações server-side.

## RPC
`get_my_navigation_modules()` retorna apenas `module_key`.

Não retorna:
- papel do usuário;
- organization_id;
- neighborhood_id;
- property_id;
- membership_id;
- dados privados do tenant.

Somente memberships ativos de usuários ativos participam do cálculo. `anonymous` não executa a RPC.

## Fail-closed no frontend
Antes da carga da RPC:
- somente `overview` fica liberado;
- nenhum módulo oculto é montado;
- deep-link para módulo não autorizado é normalizado para `#/overview`;
- convite ativado recarrega também a navegação.

## Regras de superfície
- `operations`: administração/monitoramento;
- `pilot`: administração, Admin Bairro, Monitoramento de bairro e Owner;
- `insurance`: Admin iFarm, Admin Organização e Owner;
- `access`/`audit`: Admin iFarm, Admin Organização, Admin Bairro e Owner;
- `community`: organização ou membership com escopo de bairro;
- módulos operacionais restantes são filtrados por presença de membership/papel compatível.

As regras servem somente para exibição. Uma rota visível continua sujeita ao RBAC específico do módulo.

## Critérios de aceite
1. menu não renderiza mais `navItems` completo;
2. `overview` é o único fallback antes da resposta;
3. rota oculta nunca monta componente protegido;
4. deep-link oculto cai em `overview`;
5. `get_my_navigation_modules()` não expõe IDs de escopo ou papéis;
6. somente acessos ativos geram módulos;
7. `anonymous` não executa a RPC;
8. `claim_my_invited_access()` recarrega capacidades;
9. CI/deploy exigem `access-navigation:check`;
10. DEV → STAGE antes do merge; PROD permanece intocado.
