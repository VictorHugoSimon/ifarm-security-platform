# Definition of Ready / Definition of Done — iFarm Security

## DoR
Um item só entra em desenvolvimento quando possui: ID e objetivo; usuário/ator; organização/bairro/propriedade afetados; critério Community x Private; critérios de aceite verificáveis; dependências; prioridade MoSCoW; impacto LGPD/segurança; classificação dos dados; regras de retenção quando aplicável; comportamento offline/retry quando IoT; observabilidade esperada; plano de teste; rollback/compatibilidade de migration; responsável de produto e técnico; pendências jurídicas marcadas.

## DoD
Um item só é concluído quando: critérios de aceite passaram; CI verde; typecheck/build verdes; security check verde; nenhum secret versionado; RLS/RBAC e testes negativos validados; migrations aplicadas primeiro em DEV; STAGE antes de PROD; logs/auditoria implementados sem dados excessivos; documentação atualizada; erro/fallback tratados; acessibilidade e responsividade mínimas verificadas; Community x Private preservado; IA não executa ação definitiva sem validação quando aplicável; integrações externas ficam bloqueadas sem autorização; rollback conhecido; evidência de teste registrada no PR.

## Promoção de banco
DEV → validação funcional/segurança → STAGE → smoke/integrado → aprovação → PROD. Nunca migrar diretamente para PROD.
