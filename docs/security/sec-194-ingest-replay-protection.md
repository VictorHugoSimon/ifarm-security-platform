# SEC-194 — Ingest replay protection

## Objetivo

Impedir que uma requisição de ingestão válida seja reapresentada como um novo evento apenas porque o dispositivo/gateway retransmitiu a mesma carga.

O desenho preserva o requisito rural de operação offline: eventos podem chegar atrasados depois de buffer local. Por isso a proteção **não usa uma janela curta de tempo como critério de rejeição**. A identidade estável do evento é a chave de idempotência.

## Contrato do dispositivo / Edge

Toda ingestão externa deve enviar `eventId`:

- obrigatório;
- 1–128 caracteres;
- apenas `A-Z`, `a-z`, `0-9`, `.`, `_`, `:`, `-`;
- estável para o mesmo evento durante todos os retries;
- novo somente quando o dispositivo gerar um evento realmente novo.

Para GPS Asset Security o mesmo contrato é persistido em `source_event_id`.

### Retry correto

1. Edge gera o evento e um `eventId` estável.
2. Persiste o evento + ID no buffer local antes do envio.
3. Envia ao Worker.
4. Se houver timeout/falha, retransmite **o mesmo ID**.
5. O banco reconhece a duplicata e não cria uma segunda telemetria/posição.

Gerar um ID diferente a cada retry viola o contrato e elimina a idempotência.

## Autoridade no banco

A proteção não depende apenas do frontend ou Worker.

Já existiam índices únicos:

- `device_telemetry(device_id, event_id)` para heartbeat;
- `asset_positions(asset_id, source_event_id)` para posição GPS.

A migration `0029_ingest_replay_protection.sql` adiciona wrappers server-side que:

- rejeitam ID ausente ou fora do formato;
- preservam as implementações anteriores como funções internas não executáveis pelos papéis do browser;
- retornam `accepted=false` para heartbeat duplicado;
- tratam corrida concorrente do heartbeat como duplicata em vez de criar um segundo registro;
- preservam o comportamento idempotente já existente do GPS.

## Segurança

As funções de ingestão e suas implementações internas não são executáveis por `PUBLIC`, `authenticated` ou `anonymous`. O caminho esperado continua sendo o Worker/API server-side, autenticado pela credencial do dispositivo e protegido pelos limites distribuídos da SEC-193.

Nenhuma chave bruta de dispositivo é gravada em logs ou retornada ao cliente.

## Fora de escopo

- Não implementa assinatura criptográfica por mensagem; a autenticação continua pela credencial rotacionável do dispositivo.
- Não usa timestamp curto como anti-replay porque isso quebraria sincronização após períodos offline.
- Não altera Government/Biometrics.
- Não altera PROD.

## Critérios de aceite

- `eventId` ausente é rejeitado antes da gravação.
- mesmo heartbeat + mesmo `eventId` não cria nova telemetria e retorna `accepted=false`/`duplicate`;
- mesma posição + mesmo `eventId` não cria nova posição;
- eventos distintos continuam sendo aceitos;
- índices únicos permanecem ativos;
- ingest RPCs permanecem server-side only;
- `pnpm replay:check` roda em CI, Pages STAGE e API STAGE readiness.
