# SEC-170/171/173 — Cloudflare Pages STAGE contract

Data de referência: 2026-09-10.

## Recurso reservado
- Project: `ifarm-security-web-stage`
- Provider: Cloudflare Pages, recurso exclusivo do iFarm Security
- GitHub repository: `VictorHugoSimon/ifarm-security-platform`
- Production branch: `stage`
- Root directory: repository root
- Build command: `pnpm --filter @ifarm-security/web build`
- Build output directory: `apps/web/dist`
- Framework: React + Vite

O nome `ifarm-security-web-stage` é reservado para STAGE. Não reutilizar Pages, Worker, domínio, token, account secret, binding ou infraestrutura de qualquer outro projeto.

## Bootstrap automatizado
A SEC-171 autoriza o workflow `.github/workflows/deploy-stage.yml` a criar o Pages `ifarm-security-web-stage` caso ele ainda não exista e publicar o build estático do STAGE.

O bootstrap só pode prosseguir quando o repositório estiver privado e existirem os dois secrets dedicados abaixo no repositório/ambiente deste projeto:
- `IFARM_SECURITY_CLOUDFLARE_API_TOKEN`
- `IFARM_SECURITY_CLOUDFLARE_ACCOUNT_ID`

É proibido substituir esses nomes por secrets genéricos ou reaproveitar credenciais de Instituto Államo, iFarm Core, Terra Pulse, Ser Vital, Maison Decants, Semeali ou qualquer outro projeto.

O workflow fixa Wrangler `4.130.0`, executa todos os gates locais, testa, faz typecheck, compila o web, valida `dist`, cria o projeto se necessário, publica na branch Pages `stage` e executa smoke público na URL retornada pelo Cloudflare.

## Variáveis de build permitidas no browser
Somente estas duas variáveis públicas entram no build STAGE:
- `VITE_NEON_AUTH_URL` — endpoint Neon Auth exclusivo do STAGE;
- `VITE_NEON_DATA_API_URL` — endpoint Neon Data API exclusivo do STAGE.

Elas não são credenciais. Não cadastrar no frontend `DATABASE_URL`, senha PostgreSQL, Neon API key, Cloudflare API token, device key, storage secret ou equivalente.

## SPA e headers HTTP
`apps/web/public/_redirects` contém `/* /index.html 200`. O Vite copia o arquivo para `apps/web/dist/_redirects`, permitindo fallback SPA no Pages.

A SEC-173 adiciona `apps/web/public/_headers`, também copiado pelo Vite para `dist`. O contrato exige CSP restrita, anti-framing, `nosniff`, política de referência, Permissions Policy, HSTS, isolamento de opener/resource, noindex e cache imutável apenas para assets versionados.

No STAGE/produção, `connect-src` permite somente `self` e as origens públicas do Neon Auth/Data API deste STAGE. Tiles públicos do OpenStreetMap permanecem fora da CSP porque o mapa já os desativa fora de DEV. Não usar wildcard, `unsafe-eval`, origem HTTP ou localhost.

Como `_headers` do Cloudflare Pages se aplica a assets estáticos e não a respostas de Pages Functions, qualquer futura introdução de `functions/` ou `_worker.js` exigirá reaplicar os mesmos headers no código server-side e atualizar os gates antes do merge.

## Gate de uso real
**NÃO habilitar uso real enquanto** todos os itens abaixo não estiverem concluídos:
1. repositório GitHub privado;
2. URL HTTPS do Pages criada e registrada como origem STAGE oficial;
3. origem cadastrada no Neon Auth trusted origins/redirects;
4. Data API CORS limitado à origem STAGE aprovada;
5. signup público do provider fechado por caminho oficial suportado;
6. verificação de e-mail obrigatória;
7. MFA validada para os perfis exigidos;
8. identidade QA controlada e smoke autenticado aprovado;
9. smoke público confirmar os headers SEC-173 na resposta real do Cloudflare.

A existência do Pages e o smoke público não significam aprovação para cliente, piloto ou usuário real. Até o fechamento desses controles, somente dados e identidades sintéticas são permitidos.

## Depois do primeiro deploy
A URL retornada pelo Cloudflare deve ser usada imediatamente para configurar trusted origin e CORS no Neon STAGE. PROD continua fora do escopo. Depois disso, executar a validação autenticada e registrar o aceite de promoção em etapa separada.
