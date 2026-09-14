# SEC-183 — Session & Access Landing

Data de referência: 2026-09-14.

## Objetivo
Garantir que uma sessão autenticada e verificada, mas sem acesso ativo comprovado, não carregue o dashboard do iFarm Security.

A landing é uma barreira de UX e redução de superfície. RLS, memberships, RPCs e validações server-side continuam sendo a autoridade de segurança.

## Estados
- `loading`: organizações e capacidades ainda estão sendo validadas; nenhum módulo é montado;
- `error`: houve falha na validação de acesso; o portal permanece fail-closed e oferece somente nova tentativa ou logout;
- `pending`: conta autenticada, sem organização/membership ativo; oferece somente ativação de convite e logout;
- dashboard: somente quando existe organização autorizada ou capacidade administrativa além de `overview`.

## Convites
A ativação reutiliza `claim_my_invited_access()`.

A landing:
- não possui cadastro público;
- não lista convites existentes;
- não lista organizações disponíveis;
- não informa se um e-mail possui ou não convite antes da tentativa;
- usa mensagens genéricas para reduzir enumeração de contas/tenants;
- após ativação bem-sucedida, recarrega organizações e navegação sanitizada.

## Admin iFarm
Um Admin iFarm pode continuar acessando o portal mesmo em uma instalação ainda sem organizações, porque `get_my_navigation_modules()` retorna capacidades administrativas. A regra de landing considera uma superfície autorizada quando há organizações visíveis **ou** mais módulos autorizados além de `overview`.

## Fail-closed
Se a consulta de organizações ou `get_my_navigation_modules()` falhar:
- dashboard não monta;
- mapa não monta;
- eventos/incidentes/evidências não montam;
- nenhum módulo operacional é carregado;
- usuário pode tentar novamente ou sair.

## Critérios de aceite
1. dashboard não monta antes de `accessLoaded && navigationLoaded`;
2. falha de validação mantém a sessão fora dos módulos;
3. usuário sem membership ativo fica somente na landing;
4. ativação usa exclusivamente `claim_my_invited_access()`;
5. ativação bem-sucedida recarrega acesso + navegação;
6. landing não faz consultas diretas nem RPCs por conta própria;
7. landing não expõe IDs de organização/bairro/propriedade;
8. landing não enumera convites ou usuários;
9. Admin iFarm não fica preso na landing em instalação vazia;
10. CI/deploy exigem `access-landing:check`.

## Banco
SEC-183 não cria migration nem altera schema. Ela depende dos controles já entregues pelas SEC-160, SEC-175, SEC-176 e SEC-182.

PROD permanece intocado.
