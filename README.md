# iFarm Security

Plataforma privada de segurança rural para propriedades, bairros rurais, associações, cooperativas e empresas.

## Princípios
- Isolamento total de outros projetos iFarm.
- Privacy & Security by Design.
- Multi-tenant por organização/bairro/propriedade.
- Edge-first para vídeo e conectividade rural instável.
- IA como apoio à decisão, nunca prova definitiva.
- Biometria e integrações governamentais somente em fase autorizada.

## Estrutura
- `apps/web` — portal web/PWA.
- `apps/api` — API edge/serverless.
- `packages/contracts` — contratos e tipos compartilhados.
- `packages/db` — schema, cliente e migrações PostgreSQL.
- `docs` — produto, arquitetura, backlog e governança.
- `infra` — documentação de infraestrutura exclusiva.

## Ambientes
- DEV: desenvolvimento e testes.
- STAGE: homologação.
- PROD: produção.

Nenhuma migração deve ser aplicada diretamente em PROD.
