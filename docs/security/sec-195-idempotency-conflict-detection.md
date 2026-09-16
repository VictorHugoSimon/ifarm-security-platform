# SEC-195 — Idempotency conflict detection

## Objetivo

Completar a proteção anti-replay da SEC-194 distinguindo dois cenários:

1. **retry legítimo:** mesmo `eventId` e mesmo conteúdo semântico → `duplicate`, sem nova gravação;
2. **conflito de integridade:** mesmo `eventId` com conteúdo diferente → `event_id_conflict`.

Um identificador idempotente representa um único evento. Ele não pode ser reutilizado para alterar retrospectivamente status, horário, coordenadas ou metadados.

## Heartbeat

Quando o RPC autenticado pelo dispositivo identifica uma duplicata, compara o evento persistido com o retry:

- status;
- `source_at`;
- bateria;
- RSSI;
- tipo de conexão;
- metadata.

Qualquer diferença gera `event_id_conflict`.

## Asset Security / GPS

Para uma posição duplicada são comparados:

- dispositivo GPS vinculado;
- `recorded_at`;
- latitude/longitude persistidas;
- velocidade;
- rumo;
- precisão;
- metadata.

Qualquer diferença gera `event_id_conflict`.

## Princípios

- A chave do dispositivo continua sendo validada antes de a duplicata ser aceita como legítima.
- A proteção permanece no banco, não apenas no Worker.
- RPCs de ingestão continuam sem EXECUTE para `PUBLIC`, `authenticated` e `anonymous`.
- Não há janela curta de tempo: eventos buffered/offline continuam válidos.
- O sistema não trata conflito como prova de ataque; ele é um sinal de integridade que deve ser registrado/observado pela camada operacional futura.
- PROD não é alterado nesta fase.

## Evidência DEV/STAGE — 2026-09-16

### DEV

- migration `0030_idempotency_conflict_detection.sql` aplicada em uma única transação;
- `ingest_device_heartbeat` e `ingest_asset_position` permanecem `SECURITY DEFINER`;
- `authenticated` e `anonymous` permanecem sem `EXECUTE`;
- ambas as funções contêm o guard `event_id_conflict`.

### STAGE

- migration `0030_idempotency_conflict_detection.sql` aplicada com sucesso;
- heartbeat sintético `QA-SEC195-HB-001`:
  - primeira chamada: `accepted=true`, transição `heartbeat`;
  - retry com payload idêntico: `accepted=false`, transição `duplicate`;
  - mesmo `eventId` com status divergente: erro `event_id_conflict`;
- persistência conferida: existe apenas 1 linha para `QA-SEC195-HB-001`, preservando o payload original (`status=online` e `source_at=2026-09-16T14:00:00Z`);
- o teste não revelou nem exportou a chave de ingestão: o `key_hash` foi obtido somente por subquery server-side;
- não havia asset sintético disponível no STAGE, portanto o caminho GPS foi validado por estrutura, função, guards e grants nesta rodada, sem criar dados artificiais adicionais.

### PROD

- não alterado.

## Critérios de aceite

- retry idêntico continua idempotente;
- mesmo heartbeat ID com status/horário/telemetria diferente falha com `event_id_conflict`;
- mesmo GPS ID com posição/horário/device diferente falha com `event_id_conflict`;
- índices únicos da SEC-194 permanecem ativos;
- papéis do browser continuam sem EXECUTE;
- `pnpm idempotency:check` é obrigatório na CI e nos dois pipelines STAGE.
