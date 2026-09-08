# Device Health & Telemetry — SEC-023

## Fluxo
Gateway/Edge/Dispositivo → HTTPS → Cloudflare Worker/Hono → SHA-256 da chave → Neon → telemetria → status → eventos.

## Identidade de máquina
Usuários humanos continuam em Neon Auth + RLS. Equipamentos não recebem conta humana.

Cada dispositivo pode ter até 5 chaves de ingestão ativas para permitir rotação sem indisponibilidade. O portal gera 32 bytes aleatórios, mostra o valor bruto uma única vez e envia somente SHA-256 ao banco. `device_ingest_keys` não concede SELECT para `authenticated` nem `anonymous`.

## Endpoint de heartbeat
`POST /api/v1/ingest/devices/{deviceId}/heartbeat`

Header:
`Authorization: Device <chave-do-dispositivo>`

Payload de exemplo:
```json
{
  "eventId": "hb-20260908-000001",
  "status": "online",
  "sourceAt": "2026-09-08T18:00:00Z",
  "batteryPct": 92,
  "signalRssi": -71,
  "connectionType": "4g",
  "metadata": { "buffered": false }
}
```

## Idempotência e internet rural
`eventId` é único por dispositivo. Reenvios do mesmo heartbeat retornam `transition=duplicate` e não criam telemetria duplicada. Isso permite buffer local e retry após perda de internet.

## Estados
- `online`
- `degraded`
- `offline`
- `maintenance`

Um heartbeat atualiza `last_seen_at`. A cada 5 minutos, o Worker pode executar `reconcile_stale_devices()`. Por padrão, dispositivo com mais de 900 segundos sem sinal muda para offline; o valor pode ser customizado depois por equipamento.

A transição de estado gera `security_events`. Offline de gateway/NVR recebe severidade Alta; demais equipamentos usam Atenção. Restauração gera evento Informativo.

## Segurança
- `DATABASE_URL` continua secret e não é versionado.
- A RPC de ingestão não é executável por `authenticated`/`anonymous`.
- Chaves brutas nunca são persistidas.
- Metadata é limitada a 8 KB.
- Payload HTTP é limitado a 32 KB.
- `sourceAt` não pode estar mais de 10 minutos no futuro.
- Falha de chave retorna 401 sem revelar se o dispositivo existe.

## Antes de produção
- tornar o repositório GitHub privado;
- configurar secret `DATABASE_URL` exclusivo deste projeto;
- rate limit/WAF por endpoint;
- definir rotação de chaves;
- testar gateway real com buffer/retry;
- validar intervalo por tipo de dispositivo e conectividade;
- observabilidade e alerta do próprio pipeline de ingestão.
