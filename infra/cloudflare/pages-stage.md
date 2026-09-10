# SEC-170/171 — Cloudflare Pages STAGE contract

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

O bootstrap só pode prosseguir quando existirem os dois secrets dedicados abaixo no repositório/ambiente deste projeto:
- `IFARM_SECURITY_CLOUDFLARE_API_TOKEN`
- `IFARM_SECURITY_CLOUDFLARE_ACCOUNT_ID`

É proibido substituir esses nomes por secrets genéricos ou reaproveitar credenciais de Instituto Államo, iFarm Core, Terra Pulse, Ser Vital, Maison Decants, Semeali ou qualquer outro projeto.

O workflow fixa Wrangler `4.130.0`, executa todos os gates locais, testa, faz typecheck, compila o web, valida `dist`, cria o projeto se necessário, publica na branch Pages `stage` e executa smoke público na URL retornada pelo Cloudflare.

## Variáveis de build permitidas no browser
Somente estas duas variáveis públicas entram no build STAGE:
- `VITE_NEON_AUTH_URL` — endpoint Neon Auth exclusivo do STAGE;
- `VITE_NEON_DATA_API_URL` — endpoint Neon Data API exclusivo do STAGE.

Elas não são credenciais. Não cadastrar no frontend `DATABASE_URL`, senha PostgreSQL, Neon API key, Cloudflare API token, device key, storage secret ou equivalente.

## SPA
`apps/web/public/_redirects` contém `/* /index.html 200`. O Vite copia o arquivo para `apps/web/dist/_redirects`, permitindo fallback SPA no Pages.

## Gate de uso real
**NÃO habilitar uso real enquanto** todos os itens abaixo não estiverem concluídos:
1. URL HTTPS do Pages criada e registrada como origem STAGE oficial;
2. origem cadastrada no Neon Auth trusted origins/redirects;
3. Data API CORS limitado à origem STAGE aprovada;
4. signup público do provider fechado por caminho oficial suportado;
5. verificação de e-mail obrigatória;
6. MFA validada para os perfis exigidos;
7. identidade QA controlada e smoke autenticado aprovado.

A existência do Pages e o smoke público não significam aprovação para cliente, piloto ou usuário real. Até o fechamento desses controles, somente dados e identidades sintéticas são permitidos.

## Depois do primeiro deploy
A URL retornada pelo Cloudflare deve ser usada imediatamente para configurar trusted origin e CORS no Neon STAGE. PROD continua fora do escopo. Depois disso, executar a validação autenticada e registrar o aceite de promoção em etapa separada.
