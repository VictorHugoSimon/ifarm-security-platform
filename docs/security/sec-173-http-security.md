# SEC-173 — HTTP security do frontend

Data de referência: 2026-09-10.

## Objetivo
Endurecer o frontend estático do iFarm Security antes do primeiro Cloudflare Pages STAGE, mantendo o portal privado, reduzindo risco de XSS, clickjacking, carregamento de origens indevidas, indexação e cache inadequado.

## Implementação
- `apps/web/public/_headers`: regras nativas do Cloudflare Pages para assets estáticos.
- `apps/web/public/robots.txt`: bloqueio de crawlers para o portal privado.
- `apps/web/index.html`: fallback `noindex,nofollow,noarchive`.
- `scripts/http-security-check.mjs`: invariantes versionados e executados em CI/deploy.
- `scripts/stage-smoke.mjs`: valida os headers efetivamente entregues pela URL STAGE.

## CSP
A política permite:
- scripts somente de `self`;
- estilos do próprio bundle; inline style attributes permanecem permitidos para compatibilidade com Leaflet, sem liberar scripts inline;
- imagens/fontes locais, `data:` e `blob:` quando necessário ao frontend;
- conexões apenas para `self`, Neon Auth STAGE e Neon Data API STAGE;
- workers apenas de `self`/`blob:`.

A política bloqueia:
- `object-src`;
- framing por terceiros;
- `unsafe-eval`;
- wildcard de origem;
- HTTP inseguro;
- localhost em STAGE;
- tiles públicos do OpenStreetMap fora de DEV.

## Headers adicionais
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Resource-Policy: same-origin`
- `Referrer-Policy: no-referrer`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-Permitted-Cross-Domain-Policies: none`
- `Permissions-Policy` com câmera/microfone e sensores bloqueados; geolocalização permitida somente para a própria origem por causa do iFarm SOS.
- `Strict-Transport-Security` sem `preload` e sem `includeSubDomains` até existir decisão de domínio final.

## Privacidade e indexação
O portal é privado e não deve ser indexado, inclusive quando houver produção. Foram aplicadas três barreiras: `X-Robots-Tag`, `robots.txt` e meta robots.

## Cache
`index.html` usa `no-store`; `/assets/*` usa cache longo e `immutable`, adequado ao hashing de assets do Vite.

## Limite conhecido
O `_headers` do Cloudflare Pages não cobre respostas geradas por Pages Functions. Se `functions/` ou `_worker.js` forem introduzidos, os mesmos controles deverão ser implementados na resposta server-side e o gate SEC-173 atualizado antes da publicação.

## Aceite
SEC-173 só é considerada operacional em STAGE após:
1. CI verde;
2. `_headers` e `robots.txt` presentes no `dist` e idênticos à fonte;
3. Pages STAGE realmente publicado;
4. smoke da URL real confirmar CSP e todos os headers críticos;
5. Auth/CORS/MFA continuarem respeitando os gates existentes.

PROD permanece fora desta fase.
