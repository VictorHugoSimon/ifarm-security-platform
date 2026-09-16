# SEC-196 — Ingest Conflict Response & Observability

## Objetivo

Transformar `event_id_conflict` detectado no banco pela SEC-195 em uma resposta HTTP explícita e sanitizada no Worker.

## Contrato

- heartbeat e Asset Security/GPS retornam HTTP `409 Conflict`;
- body público: `{ "error": "event_id_conflict", "requestId": "..." }`;
- o `requestId` permite correlação operacional sem expor dados do evento;
- o log estruturado usa `warn` e evento `ingest_idempotency_conflict`;
- o log inclui somente `requestId`, `environment` e `route`;
- não registrar device key, key hash, payload, metadata, coordenadas, asset/device ID ou mensagem SQL bruta;
- conflito de ID é sinal de integridade, não prova automática de ataque;
- retries idênticos continuam retornando o comportamento idempotente da SEC-195, sem 409;
- PROD permanece fora desta etapa.

## Critérios de aceite

- classificador reconhece `event_id_conflict` sem confundir outros erros;
- heartbeat trata conflito antes dos guards genéricos `invalid_`/500;
- asset-position trata conflito antes dos guards genéricos `invalid_`/500;
- resposta inclui somente erro sanitizado + requestId;
- log não contém payload/segredo/identificador do dispositivo;
- CI e os dois pipelines STAGE exigem `pnpm ingest-conflict:check`.
