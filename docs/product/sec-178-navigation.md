# SEC-178 — Navegação real entre módulos

Data de referência: 2026-09-11.

## Objetivo
Transformar o menu lateral do iFarm Security em navegação funcional, deixando de montar todos os módulos simultaneamente e permitindo deep-link por URL.

## Estratégia
Foi adotado hash routing nativo, sem nova dependência:
- `#/overview`
- `#/operations`
- `#/sos`
- `#/assets`
- `#/insurance`
- `#/community`
- `#/rural`
- `#/devices`
- `#/access`
- `#/audit`
- `#/health`
- `#/events`
- `#/incidents`
- `#/evidence`
- `#/map`

## Comportamento
- somente o módulo da rota ativa é montado;
- back/forward do navegador funciona via `hashchange`;
- rota ausente ou inválida normaliza para `#/overview`;
- item ativo recebe `aria-current="page"`;
- título do documento e `<h1>` acompanham o módulo atual;
- sessão e faixa de identidade permanecem persistentes no shell;
- sair continua independente da rota;
- não foi adicionada dependência de roteamento externa.

## Ganho operacional
Antes da SEC-178 o dashboard montava Operations, SOS, Asset Security, Insurance, Community, estrutura rural, dispositivos, acessos, auditoria, telemetria, eventos, incidentes, evidências e mapa ao mesmo tempo. Isso podia disparar consultas e efeitos de módulos que o usuário nem estava visualizando.

Após a SEC-178, somente a página selecionada é montada, reduzindo trabalho no browser e chamadas desnecessárias aos serviços.

## Segurança
A navegação não altera RBAC/RLS. Trocar a rota nunca concede acesso: cada módulo continua dependendo das RPCs/policies existentes.

## Critérios de aceite
1. todos os itens do menu funcionalmente navegam;
2. somente o item atual fica `active`;
3. `aria-current` identifica a página ativa;
4. URL reflete o módulo atual;
5. refresh/deep-link preserva a rota;
6. rota inválida cai em Overview;
7. back/forward atualiza a página;
8. somente o componente da rota ativa é montado;
9. TypeScript/build permanecem verdes;
10. não exige alteração de banco, DEV/STAGE/PROD.
