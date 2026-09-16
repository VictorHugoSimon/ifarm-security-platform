# SEC-191 — API Security Perimeter

## Objetivo

Endurecer o Worker de ingestão do iFarm Security antes da primeira exposição em STAGE, sem alterar o modelo de autorização de dispositivos e sem declarar controles que ainda não existem na borda.

## Escopo implementado

- limite máximo de 32 KiB para o corpo dos endpoints de ingestão;
- verificação do tamanho real do body, mesmo quando `Content-Length` estiver ausente ou não for confiável;
- `application/json` obrigatório para heartbeat e posição de ativos;
- contrato explícito de método por rota conhecida, retornando 405 + `Allow`;
- 404 sanitizado para rotas desconhecidas;
- `x-request-id` presente em 404/405 e logs estruturados;
- headers globais: `Cache-Control: no-store`, CSP restritiva, `Permissions-Policy`, `Referrer-Policy`, `X-Content-Type-Options` e `X-Frame-Options`;
- CORS wildcard não é habilitado no Worker de ingestão;
- erros internos continuam sem expor mensagem SQL, conexão, token, device key ou stack trace.

## Rate limiting

Este hardening **não substitui rate limiting distribuído**. Um limite em memória dentro de um Worker não seria garantia confiável entre isolates/regiões e, portanto, não é apresentado como controle real.

No momento da SEC-191, `/api/v1/system/status` mantinha `distributedRateLimitingConfigured=false`. Esse bloqueio foi posteriormente tratado pela **SEC-193 — Distributed Rate Limiting**, que adiciona bindings nativos do Cloudflare, chave por credencial de dispositivo hasheada e comportamento fail-closed em STAGE/PROD. A SEC-193 passa a ser a autoridade para esse controle.

A proteção distribuída deve continuar considerando retries, conectividade intermitente e rajadas após buffer offline, sem depender de IP compartilhado por NAT/CGNAT rural.

## Contrato dos endpoints de ingestão

- `POST /api/v1/ingest/devices/:deviceId/heartbeat`
- `POST /api/v1/ingest/assets/:assetId/position`
- autenticação continua via `Authorization: Device <key>`;
- chave é transformada em SHA-256 antes de chegar às funções SQL;
- metadata continua limitada separadamente a 8 KiB;
- timestamps futuros além da tolerância existente continuam recusados;
- endpoint não deve aceitar browser cross-origin por conveniência.

## Critérios de aceite

1. body > 32 KiB é rejeitado com 413 mesmo sem `Content-Length`;
2. media type diferente de `application/json` é rejeitado com 415 para requisições autenticadas de ingestão;
3. método incorreto em rota conhecida retorna 405 sem revelar implementação;
4. rota inexistente retorna 404 sanitizado;
5. respostas recebem headers defensivos e `Cache-Control: no-store`;
6. estado do rate limiting é reportado honestamente; a configuração distribuída real é governada pela SEC-193;
7. testes automatizados e `pnpm api-security:check` passam;
8. o gate passa a ser obrigatório na CI e no workflow de deploy API STAGE;
9. nenhum recurso PROD é criado ou modificado.

## Fora de escopo original da SEC-191

- rate limiting distribuído real — posteriormente tratado pela SEC-193;
- mTLS de dispositivo;
- custom domain da API;
- integração governamental/biometria;
- mudança de PROD.
