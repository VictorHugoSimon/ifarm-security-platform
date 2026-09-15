# iFarm Security API — STAGE Worker Contract

Data de referência: 2026-09-15.

## Recurso exclusivo
- Provider: Cloudflare Workers
- Worker: `ifarm-security-api-stage`
- Config: `apps/api/wrangler.stage.toml`
- Ambiente: `stage`
- Cron: `*/5 * * * *`
- Endpoint público temporário esperado: `https://<account-subdomain>.workers.dev`

## Segredos
Apenas server-side:
- `DATABASE_URL`, recebido no deploy pelo GitHub secret `IFARM_SECURITY_STAGE_DATABASE_URL` e enviado ao Wrangler via `--secrets-file` temporário.

Credenciais Cloudflare exclusivas:
- `IFARM_SECURITY_CLOUDFLARE_API_TOKEN`
- `IFARM_SECURITY_CLOUDFLARE_ACCOUNT_ID`

É proibido reutilizar token, banco, Worker ou secret de outro projeto.

## Gates antes de deploy
1. Repositório GitHub privado.
2. CI completa verde.
3. Config STAGE fixa `APP_ENV=stage` e nome exclusivo.
4. `DATABASE_URL` ausente do código/config/artefato e presente somente como secret server-side.
5. Dry-run do Wrangler verde.
6. Testes e typecheck verdes.

## Smoke pós-deploy
- `GET /health` → 2xx e `ok=true`.
- `GET /ready` → 2xx e `ready=true`.
- `GET /api/v1/system/status` → flags `humanMonitoringAssumed=false`, `publicDispatchEnabled=false`, `governmentIntegration=false`, `biometricMatching=false`.

## Segurança operacional
- O Worker não autoriza acesso ao portal; isso permanece no Neon Auth/Data API/RBAC.
- Heartbeat e GPS exigem `Device <key>` e chaves dedicadas de ingestão.
- Nunca logar `DATABASE_URL`, Device keys, payloads sensíveis ou erros brutos do banco.
- O cron apenas executa reconciliação de dispositivos obsoletos; não presume monitoramento humano.
- Não criar Worker PROD nesta etapa.

## Bloqueadores atuais
O workflow permanece fail-closed enquanto o repositório estiver público ou enquanto faltarem secrets exclusivos. Nenhum recurso Cloudflare foi criado por este contrato.
