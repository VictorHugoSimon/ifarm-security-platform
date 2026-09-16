# SEC-193 — Plano de validação

## CI
- `pnpm rate-limit:check` deve passar antes de install/test/typecheck/build.
- testes unitários devem comprovar binding ausente em STAGE, 429 e chave hasheada.
- TypeScript deve validar o tipo Cloudflare `RateLimit`.
- Wrangler dry-run do pacote API deve aceitar `[[ratelimits]]` no contrato STAGE.

## STAGE real
O deploy real permanece bloqueado pelo gate de repositório privado e credenciais dedicadas. Quando esse gate for liberado em fase posterior:
1. publicar `ifarm-security-api-stage` com os dois bindings;
2. `/api/v1/system/status` deve retornar `distributedRateLimitingConfigured=true`;
3. `/ready` deve continuar exigindo DB;
4. smoke de método incorreto deve continuar 405;
5. teste controlado de carga deve comprovar 429 sem registrar a credencial bruta;
6. observar logs por `scope=route/device` e recalibrar limites do piloto se necessário.

Nenhum teste de carga será executado contra PROD e nenhum recurso PROD faz parte desta entrega.
