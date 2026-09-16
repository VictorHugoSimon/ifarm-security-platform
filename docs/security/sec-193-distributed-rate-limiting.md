# SEC-193 — Distributed Rate Limiting

## Objetivo
Adicionar proteção distribuída ao Worker de ingestão antes do primeiro STAGE real, sem usar IP como identidade e sem tratar rate limiting como mecanismo exato de contabilidade.

## Fonte oficial
Cloudflare Workers Rate Limiting binding, documentação revisada em 2026-09-16. O binding é local ao ponto de presença (PoP), usa contadores eventualmente consistentes e aceita uma chave estável definida pela aplicação.

## Estratégia
Duas camadas no STAGE:

1. `INGEST_DEVICE_RATE_LIMITER`
   - chave: `<route>:SHA256(device-credential)`;
   - limite provisório: 120 chamadas / 60 s;
   - namespace exclusivo reservado: `1932609161`.

2. `INGEST_ROUTE_RATE_LIMITER`
   - chave: `heartbeat` ou `asset-position`;
   - limite provisório: 6.000 chamadas / 60 s por PoP;
   - namespace exclusivo reservado: `1932609162`.

Os números são metas técnicas provisórias do piloto, não SLA e não limite comercial. Devem ser recalibrados com telemetria real.

## Segurança
- A credencial `Device <key>` nunca entra em logs nem no limiter em texto puro.
- O Worker calcula SHA-256 localmente antes de compor a chave por dispositivo.
- Nenhuma limitação por IP é usada: NAT rural, operadoras móveis, satélite e CGNAT podem compartilhar IP entre múltiplos dispositivos legítimos.
- Resposta ao exceder limite: HTTP 429, `Retry-After: 60`, erro sanitizado `rate_limited` + `requestId`.
- Falha interna do binding em STAGE/PROD: HTTP 503 `rate_limiter_unavailable`.
- Binding ausente em STAGE/PROD: HTTP 503 `rate_limiter_not_configured`.
- DEV/test pode operar sem bindings, mas `/api/v1/system/status` deve reportar `distributedRateLimitingConfigured=false`.

## Fail-closed
STAGE e PROD não executam ingestão quando os dois bindings não estão presentes. Isso evita regressão para o comportamento anterior, no qual o status declarava explicitamente que rate limiting distribuído não estava configurado.

## Cloudflare
`apps/api/wrangler.stage.toml` contém os dois `[[ratelimits]]`. Os IDs são específicos do iFarm Security e não devem ser reutilizados em outro Worker/projeto, pois bindings com o mesmo `namespace_id` compartilham contadores dentro da conta Cloudflare.

Nenhum secret adicional é necessário para os bindings; a autorização é incorporada ao binding do Worker. O deploy real continua bloqueado enquanto o repositório estiver público e/ou faltarem as credenciais exclusivas já exigidas pelo workflow.

## Limitações conhecidas
- Rate Limiting API é por localização Cloudflare, não um contador global estritamente consistente.
- Não deve ser usada para cobrança, faturamento, quota contratual ou prova de volume exato.
- Proteção volumétrica adicional na borda/WAF pode ser necessária em escala maior.
- O projeto ainda precisa de métricas reais de 429 para recalibrar limites durante o piloto.

## Aceite
- CI valida configuração, fail-closed, hash da credencial, ausência de IP e testes.
- STAGE config possui os dois bindings exclusivos.
- Testes cobrem binding ausente, 429 e status configurado.
- `/api/v1/system/status` deixa de usar constante e reflete presença real dos bindings.
- PROD permanece fora do escopo desta entrega.
