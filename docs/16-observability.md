# SEC-110 — Observabilidade e Readiness

## Endpoints
- `GET /health`: liveness do Worker; não depende do banco.
- `GET /ready`: prontidão real. Retorna 503 quando `DATABASE_URL` não existe ou o PostgreSQL não responde.
- `GET /api/v1/system/status`: capacidades habilitadas/desabilitadas sem revelar secrets.

## Logs estruturados
Cada requisição recebe `x-request-id`. Logs incluem somente: nível, evento, serviço, ambiente, requestId, método, pathname, status e duração. Não registrar Authorization, Device keys, payload de câmera/GPS, connection strings ou mensagem bruta do banco.

## Eventos internos de observabilidade
- `http_request`
- `readiness_database_failed`
- `heartbeat_ingest_failed`
- `asset_position_ingest_failed`
- `scheduled_reconcile_complete`
- `scheduled_reconcile_failed`
- `scheduled_reconcile_skipped`

## Alertas futuros
Quando houver ambiente privado e provedor de observabilidade contratado, criar alertas para: readiness 503, taxa de erro 5xx, aumento de offline, backlog de eventos críticos, SOS não reconhecido, falha do cron e degradação do banco.

## Dados sensíveis
Logs operacionais devem ser minimizados e ter retenção própria. Evidência, vídeo, biometria e payload bruto não pertencem a logs de aplicação.
