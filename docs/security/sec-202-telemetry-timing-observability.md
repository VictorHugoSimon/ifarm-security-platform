# SEC-202 — Telemetry Timing Observability

## Objetivo

Dar ao Operations/SOC uma visão agregada de atraso de sincronização, heartbeats históricos e qualidade de relógio sem expor payload, metadata, eventId, evidências ou gravações.

A SEC-202 também regulariza um **schema drift observado em DEV/STAGE**: os ambientes já possuíam `device_telemetry.ingest_ordering`, sua constraint/índice e uma versão preliminar da RPC de diagnóstico proveniente de trabalho anterior que não foi mergeado. A migration canônica agora é `0034_telemetry_timing_observability.sql`.

## O que esta SEC não faz

- não redefine `ingest_device_heartbeat_legacy_impl()`;
- não altera as garantias SEC-198 de ordenação de heartbeat;
- não altera as garantias SEC-199/200 de concorrência/empate temporal do GPS;
- não altera replay/idempotência;
- não acessa Evidence Vault ou recordings;
- não interpreta atraso, buffer ou clock drift como falha, adulteração ou crime;
- não toca PROD.

## Classificação de timing

`device_telemetry.ingest_ordering` aceita apenas:

- `legacy_unknown`: registro anterior à classificação;
- `current`: observação temporalmente atual em relação ao watermark do dispositivo;
- `historical`: observação recebida depois, mas cujo timestamp efetivo não supera `devices.last_heartbeat_source_at`.

A migration usa um trigger `BEFORE INSERT` idempotente. Se uma rota de ingestão já gravar explicitamente `current` ou `historical`, o trigger preserva essa classificação. Caso a linha chegue com o default `legacy_unknown`, a classificação é calculada server-side usando `source_at`, `received_at` e o watermark atual.

## Hardening Community × Fazenda privada

Durante a validação foi identificado que `app_has_operations_access()` permitia `admin_neighborhood` quando o bairro coincidia, mesmo com `property_id` privado.

SEC-202 corrige a autoridade do banco:

- Admin Organização: escopo da organização;
- Admin Bairro: **somente comunidade**, com `property_id IS NULL`;
- Monitoramento: somente escopo explicitamente atribuído;
- Admin iFarm elegível: autoridade de plataforma conforme lifecycle já existente.

O menu/frontend não é a autoridade de segurança; a RPC e as demais operações continuam subordinadas ao banco.

## RPC sanitizada

`get_operations_telemetry_timing_health(p_hours)` limita a janela a 1–168 horas e retorna apenas:

- identificador/nome do dispositivo;
- escopo `community` ou `private`;
- total de telemetrias;
- quantidade histórica;
- quantidade classificada como buffer operacional;
- relógio adiantado;
- ausência de `source_at`;
- atraso máximo em segundos;
- último recebimento.

Não retorna `metadata`, payload, `event_id`, storage key, evidence ID, recording ID ou IP/hash.

## UI Operations/SOC

O painel mostra “Sincronização / relógio · últimas 24h” apenas para o escopo autorizado e destaca:

- históricos;
- em buffer;
- relógio adiantado;
- sem sourceAt.

Disclaimer obrigatório: **Diagnóstico temporal ≠ falha ou adulteração**. Esses sinais servem para diagnóstico técnico de conectividade/sincronização e não constituem evidência definitiva de falha, sabotagem ou ocorrência criminal.

## Promoção

1. CI completa verde.
2. Aplicar `0034` em DEV.
3. Validar trigger, grants, RPC e limite Community × privado.
4. Aplicar a mesma migration em STAGE.
5. Repetir matriz com fixtures QA.
6. Registrar evidências e rerodar CI final.
7. Merge.

PROD permanece fora do escopo desta SEC.

## Evidência live inicial

Antes da migration canônica, DEV e STAGE já apresentavam:

- coluna `ingest_ordering`;
- constraint `legacy_unknown/current/historical`;
- índice `idx_device_telemetry_timing_window`.

Também foi observado que o helper live `app_has_operations_access()` não exigia `property_id IS NULL` para Admin Bairro. A migration 0034 é idempotente e corrige esse limite antes de a observabilidade ser considerada pronta.
