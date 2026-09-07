# Ambientes

| Ambiente | Git | Neon | Uso |
|---|---|---|---|
| DEV | develop | dev | desenvolvimento e validação técnica |
| STAGE | release/homologação | stage | homologação funcional e integração |
| PROD | main | main | produção |

## Regra de promoção

Nenhuma alteração de schema ou infraestrutura deve ir diretamente para PROD. O fluxo obrigatório é DEV → STAGE → PROD, com evidência de validação antes de cada promoção.

## Secrets

Secrets não pertencem ao Git. Cada ambiente deve usar credenciais próprias e segregadas no provedor correspondente.
