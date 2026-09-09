# SEC-160 — Auth e CORS readiness do STAGE

Data de referência: 2026-09-09.

## Objetivo
Fechar os controles que podem ser validados e versionados sem criar domínio fictício, sem abrir acesso e sem editar diretamente tabelas internas não suportadas do Neon Auth.

## Estado observado do STAGE

### Neon Auth
- provider: Better Auth gerenciado pela Neon;
- endpoint próprio do STAGE;
- `trusted_origins`: vazio;
- `allow_localhost=true`;
- e-mail/senha habilitado;
- signup do provider ainda permitido (`disableSignUp=false` / `allow_sign_up=true`);
- verificação de e-mail ainda não obrigatória;
- envio de verificação no signup/sign-in ainda desabilitado;
- MFA continua apenas modelado na aplicação (`mfa_required=true`), sem enforcement comprovado no provider;
- frontend não oferece fluxo de cadastro público e usa somente `signIn.email`.

### Neon Data API
- endpoint próprio do STAGE;
- status ativo;
- schema exposto: somente `public`;
- limite de 1000 linhas;
- role claim `.role`;
- OpenAPI desabilitado;
- CORS atual: somente `http://localhost:5173`.

## Decisão de segurança
O STAGE ainda **não está aprovado para usuários reais**. Permanecem bloqueadores:
1. definir a URL oficial do frontend STAGE;
2. cadastrar a origem STAGE no Auth/redirect whitelist;
3. substituir o CORS localhost pelo domínio STAGE aprovado, mantendo localhost apenas quando explicitamente necessário para desenvolvimento;
4. desabilitar signup público no provider por caminho oficial suportado;
5. exigir verificação de e-mail por caminho oficial suportado;
6. configurar e provar MFA para os perfis definidos pelo produto;
7. criar uma identidade de QA com credencial controlada para smoke end-to-end sem reutilizar conta de outro projeto.

Não foi feita alteração direta em `neon_auth.project_config`, pois a integração disponível não expõe update oficial para `disableSignUp`/`requireEmailVerification`. O projeto não deve depender de escrita manual em configuração interna gerenciada pelo provider.

## Controles já aprovados
- nenhuma função `signUp` existe no `AuthGate`;
- login informa que a conta deve ser previamente autorizada;
- acesso ao tenant continua dependente de RBAC/RLS/invite;
- browser usa apenas `VITE_NEON_AUTH_URL` e `VITE_NEON_DATA_API_URL`;
- nenhum `DATABASE_URL`, password, token ou connection string PostgreSQL é necessário no frontend;
- DEV e STAGE têm endpoints Auth/Data API separados;
- repositório público continua sem secrets e sem dados reais.

## Gate de CI
`pnpm auth:check` falha caso:
- seja introduzido signup público no frontend;
- apareça variável privilegiada/secret no browser client;
- um exemplo de `.env` do browser passe a carregar algo além das URLs públicas Auth/Data API;
- DEV e STAGE apontem para o mesmo Auth endpoint;
- o STAGE deixe de usar endpoints `neonauth`/`apirest` próprios do `ifarm_security`.

## Próximo gate
SEC-170 deve tratar o frontend STAGE/deploy e smoke end-to-end somente depois que existir origem STAGE oficial. PROD permanece fora do escopo.
