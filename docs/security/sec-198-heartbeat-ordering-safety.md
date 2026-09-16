# SEC-198 — Heartbeat Ordering Safety

Data de referência: 2026-09-16.

## Objetivo

Proteger o estado operacional atual de câmeras, gateways, NVRs e sensores contra heartbeats atrasados que chegam depois por buffer/sincronização offline.

O iFarm Security precisa aceitar internet rural instável sem transformar sincronização tardia em falso estado atual.

## Risco corrigido

Antes da SEC-198, um heartbeat com `sourceAt` antigo e `eventId` novo podia ser recebido depois de um heartbeat mais recente e:

- atualizar `devices.status` para um estado antigo;
- atualizar `last_seen_at` como se o heartbeat atrasado fosse atual;
- criar `device.offline`, `device.degraded`, `device.restored` ou `device.status_changed` indevido;
- induzir o SOC/portal a interpretar histórico atrasado como condição presente.

Replay/idempotência não resolve esse caso porque o evento pode ter um `eventId` perfeitamente novo e válido.

## Contrato

Cada dispositivo passa a manter `devices.last_heartbeat_source_at`, que representa o timestamp efetivo do heartbeat atualmente refletido em `devices.status`.

Timestamp efetivo:

- `sourceAt`, quando informado pelo edge/gateway;
- `receivedAt`, quando `sourceAt` não existe.

Um heartbeat é classificado como histórico quando seu timestamp efetivo é **menor ou igual** ao watermark atual.

### Heartbeat corrente

- é gravado em `device_telemetry`;
- pode atualizar `devices.status`;
- atualiza `last_seen_at`;
- avança `last_heartbeat_source_at`;
- pode gerar evento de transição operacional.

### Heartbeat histórico

- continua gravado em `device_telemetry` para diagnóstico/auditoria;
- retorna `accepted=true` e `transition=historical` na ingestão inicial;
- não altera `devices.status`;
- não altera `last_seen_at`;
- não altera `last_status_changed_at`;
- não altera `last_heartbeat_source_at`;
- não cria evento de mudança de status.

Uma repetição posterior do mesmo `eventId` continua seguindo a proteção SEC-194/195: retry idempotente e conflito quando o mesmo ID chega com payload semanticamente diferente.

## Concorrência

A implementação usa `FOR UPDATE OF d` durante a ingestão do heartbeat para serializar alterações do estado corrente de um mesmo dispositivo. Isso impede dois heartbeats concorrentes de decidirem o estado atual com base no mesmo watermark antigo.

## Backfill

Na promoção da migration `0031`, `last_heartbeat_source_at` é preenchido com o maior `coalesce(source_at, received_at)` já presente em `device_telemetry` para cada dispositivo.

Isso evita que o primeiro heartbeat atrasado após a migration sobrescreva o estado atual por ausência de watermark.

## Segurança

`ingest_device_heartbeat_legacy_impl` permanece server-side only:

- sem EXECUTE para `PUBLIC`;
- sem EXECUTE para `authenticated`;
- sem EXECUTE para `anonymous`.

A API Worker continua sendo a borda de entrada autorizada com device key, rate limiting, replay protection e idempotência.

## Relação com GPS

`ingest_asset_position_legacy_impl` já protege posição atual por `assets.last_position_at`: posições antigas são armazenadas como `historical` sem mover a localização/geofence atual. A SEC-198 alinha heartbeat com o mesmo princípio.

## Validação executada

### CI

CI #84 passou integralmente antes da promoção ao banco, incluindo:

- migration inventory;
- replay protection;
- idempotency conflict;
- API idempotency contract;
- heartbeat ordering invariants;
- deploy readiness;
- testes automatizados;
- TypeScript/build;
- dry-run do Worker STAGE;
- artefato Pages.

### DEV

Migration `0031_heartbeat_ordering_safety.sql` aplicada em uma única transação.

Validações:

- coluna `devices.last_heartbeat_source_at` presente;
- `authenticated` sem EXECUTE no `ingest_device_heartbeat_legacy_impl`;
- `anonymous` sem EXECUTE no `ingest_device_heartbeat_legacy_impl`;
- DEV possuía `0` dispositivos e `0` chaves ativas, portanto não foram criados fixtures persistentes apenas para o smoke.

### STAGE

Migration `0031` aplicada após DEV.

Fixture utilizada: `QA-SEC150 Câmera Privada A` (`40000000-0000-4000-8000-000000000002`), já existente e sem dados reais.

Cenário executado:

1. heartbeat corrente `QA-SEC198-CURRENT-001`, `sourceAt=2026-09-16T18:00:00Z`, status `online`;
2. heartbeat atrasado `QA-SEC198-HISTORICAL-001`, `sourceAt=2026-09-16T17:00:00Z`, status `offline`;
3. retry idempotente do heartbeat atrasado com o mesmo payload;
4. tentativa do mesmo `eventId` com payload diferente;
5. novo evento `QA-SEC198-EQUAL-001` no mesmo timestamp do watermark (`18:00Z`) com status `offline`.

Resultados:

- corrente: `accepted=true`, `transition=heartbeat`;
- atrasado: `accepted=true`, `current_status=online`, `transition=historical`;
- retry: `accepted=false`, `transition=duplicate`;
- mesmo `eventId` + payload diferente: bloqueado com `event_id_conflict`;
- timestamp igual ao watermark: `accepted=true`, `current_status=online`, `transition=historical`;
- `devices.status` final permaneceu `online`;
- `last_heartbeat_source_at` final permaneceu `2026-09-16T18:00:00Z`;
- `last_seen_at` permaneceu no heartbeat corrente e não avançou pelos eventos históricos posteriores;
- `3` linhas QA foram preservadas em `device_telemetry` para rastreabilidade;
- `0` eventos de transição operacional foram gerados para os heartbeats histórico/empatado.

Os registros têm prefixo `QA-SEC198` e pertencem exclusivamente ao ambiente STAGE.

## Promoção

Sequência obrigatória:

1. CI verde;
2. DEV;
3. validar heartbeat novo → heartbeat antigo → retry;
4. STAGE;
5. repetir matriz com fixture QA;
6. registrar evidência;
7. merge.

PROD permanece fora desta etapa.
