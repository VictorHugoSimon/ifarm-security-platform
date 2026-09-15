# SEC-193 — API Abuse Protection / Distributed Rate Limiting

Data de referência: 2026-09-15.

## Objetivo

Proteger os endpoints de ingestão do iFarm Security contra rajadas, credenciais abusivas e sobrecarga acidental antes que as requisições alcancem o Neon, sem confundir rate limiting com autenticação, faturamento ou contabilização exata.

## Recurso adotado

Cloudflare Workers Rate Limiting binding, recurso GA do Workers. O binding é aplicado dentro do Worker depois que a rota é identificada e antes do acesso ao banco.

A infraestrutura do Cloudflare mantém os contadores por localização Cloudflare e com consistência permissiva/eventual. Portanto este mecanismo é **proteção contra abuso**; **não é mecanismo de faturamento**, medição contratual ou contabilidade exata.

## Duas camadas

### 1. Circuit breaker por rota
Binding: `INGEST_ROUTE_ABUSE_GUARD`

STAGE:
- namespace candidato exclusivo: `193002`;
- 6000 chamadas por 60 segundos;
- chave estável: `route:<routeKey>`.

Objetivo: conter floods que variem credenciais ou enviem credenciais inválidas mas sintaticamente plausíveis, antes de pressionar o banco.

### 2. Limite por credencial + rota
Binding: `INGEST_ACTOR_RATE_LIMITER`

STAGE:
- namespace candidato exclusivo: `193001`;
- 120 chamadas por 60 segundos;
- chave: `credential:<routeKey>:<sha256-da-chave-bruta>`.

A chave bruta nunca entra na chave do limiter, em logs ou respostas. O SHA-256 é calculado no Worker e reaproveitado na autenticação do banco.

## Por que não usar IP como identidade primária

A orientação do Cloudflare alerta que IP pode representar vários usuários legítimos. Em área rural isso é especialmente relevante por CGNAT, links 4G/5G, rádio, satélite e gateways compartilhados. Portanto a política é **não usar IP como identidade primária** do rate limit de dispositivo.

Uma camada WAF/IP poderá existir no futuro como defesa adicional, mas não substitui a identidade por credencial e precisa ser calibrada para conectividade rural.

## Fail-closed

Em `stage` e futura `production`:
- se um dos dois bindings estiver ausente, os endpoints de ingestão retornam `503 rate_limiter_not_configured`;
- se o binding falhar, retornam `503 rate_limiter_unavailable`;
- `/ready` também retorna 503 quando os bindings obrigatórios não estão configurados;
- `/api/v1/system/status` só informa `distributedRateLimitingConfigured=true` quando os dois bindings existem.

Em ambiente local/test, a ausência do binding é permitida para desenvolvimento e testes unitários.

## Resposta 429

Quando o limite é excedido:
- HTTP `429`;
- `Retry-After: 60`;
- body sanitizado com `error=rate_limited` e `requestId`;
- log estruturado informa apenas rota, ambiente e escopo (`route` ou `credential`), sem chave bruta ou hash.

## Isolamento de namespaces

Os IDs `193001` e `193002` são candidatos reservados ao **iFarm Security STAGE**, mas Cloudflare exige que `namespace_id` seja único dentro da conta. Como ainda não existe conector Cloudflare disponível nesta conversa, a unicidade na conta não foi comprovada.

Por isso o workflow de deploy API STAGE exige explicitamente:

`IFARM_SECURITY_RATE_LIMIT_NAMESPACES_APPROVED=true`

Essa variável só deve ser habilitada depois de validar que esses IDs não são usados por outro Worker da conta. Isso respeita a regra de não reutilizar recursos de outros projetos.

## Escopo das rotas

A proteção é aplicada a:
- `POST /api/v1/ingest/devices/:deviceId/heartbeat`;
- `POST /api/v1/ingest/assets/:assetId/position`.

Endpoints de saúde/status não consomem o limiter de ingestão.

## Limitações

- o rate limit do Workers é por localização Cloudflare, não um contador global estrito;
- os contadores são permissivos/eventualmente consistentes;
- não substitui autenticação por chave de dispositivo, validação de payload, RLS/RPC ou controles de banco;
- não comprova proteção contra DDoS em escala; WAF e demais controles de borda poderão complementar a arquitetura;
- os números 120/min e 6000/min são limites técnicos iniciais para STAGE e devem ser calibrados com telemetria do piloto antes de produção.

## Critérios de aceite

1. STAGE possui bindings exclusivos por credencial e por rota;
2. ausência de binding em STAGE bloqueia readiness e ingestão;
3. credencial é identificada no limiter apenas por SHA-256, nunca por segredo bruto;
4. IP não é identidade primária;
5. excesso retorna 429 + Retry-After;
6. falha do limiter retorna 503, não bypass;
7. status só marca rate limiting como configurado quando os dois bindings existem;
8. deploy exige aprovação explícita dos namespace IDs;
9. CI testa 429, fail-closed e ausência de segredo nas chaves/logs;
10. PROD permanece fora desta fase.
