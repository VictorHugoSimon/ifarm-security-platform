# SEC-170 — Cloudflare Pages STAGE contract

Data de referência: 2026-09-09.

## Recurso planejado
- Project: `ifarm-security-web-stage`
- Provider: Cloudflare Pages, recurso exclusivo do iFarm Security
- GitHub repository: `VictorHugoSimon/ifarm-security-platform`
- Production branch: `stage`
- Root directory: repository root
- Build command: `pnpm --filter @ifarm-security/web build`
- Build output directory: `apps/web/dist`
- Framework: React + Vite

O nome `ifarm-security-web-stage` é reservado para STAGE. O recurso final não deve reutilizar Pages, Worker, domínio, token ou binding de nenhum outro projeto.

## Variáveis de build permitidas no browser
Somente as duas variáveis públicas abaixo devem ser cadastradas para o build STAGE:
- `VITE_NEON_AUTH_URL` — endpoint Neon Auth exclusivo do STAGE;
- `VITE_NEON_DATA_API_URL` — endpoint Neon Data API exclusivo do STAGE.

Elas são endpoints públicos do browser e não são credenciais. Não cadastrar no frontend `DATABASE_URL`, senha PostgreSQL, token Neon, API token Cloudflare, device key, storage secret ou qualquer segredo equivalente.

## SPA
`apps/web/public/_redirects` contém `/* /index.html 200`. O Vite copia arquivos de `public/` para o output e Cloudflare Pages interpreta `_redirects` no diretório estático. Isso permite abrir URLs internas do SPA sem 404 no refresh.

## Bloqueador atual
**NÃO criar deploy enquanto** não houver uma decisão explícita sobre a origem oficial do STAGE e os seguintes controles não puderem ser aplicados juntos:
1. origem HTTPS oficial do frontend STAGE;
2. origem cadastrada em Neon Auth trusted origins/redirects;
3. Data API CORS atualizado para a origem aprovada;
4. política do Auth provider com signup público fechado e verificação de e-mail obrigatória por caminho oficial suportado;
5. estratégia de MFA validada;
6. identidade QA controlada para smoke autenticado.

Enquanto esses itens estiverem pendentes, a SEC-170 entrega somente prontidão de código e contrato, não um ambiente público utilizável.

## Smoke sem credenciais
Depois que a URL STAGE existir, executar:
`IFARM_SECURITY_STAGE_URL=https://<host-aprovado> pnpm stage:smoke`

O smoke público valida:
- HTTPS e origem não-localhost;
- resposta HTML da raiz;
- presença da marca iFarm Security;
- fallback SPA em rota inexistente.

Smoke autenticado será uma etapa separada e nunca deve usar credenciais de outro projeto.
