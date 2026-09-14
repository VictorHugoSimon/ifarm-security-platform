# SEC-184 — Auth Provider Hardening

Data de referência: 2026-09-14.

## Objetivo
Fechar o hardening do Managed Better Auth usado pelo iFarm Security sem editar tabelas internas do schema `neon_auth` e sem declarar controles que o provider ainda não suporta.

## Estado live observado antes da execução do hardening
DEV e STAGE estavam com:
- `email_password.enabled=true`;
- `allow_sign_up=true`;
- `require_email_verification=false`;
- `verify_email_on_sign_up=false`;
- `verify_email_on_sign_in=false`;
- `email_verification_method=otp`;
- `allow_localhost=true`;
- nenhum OAuth social configurado;
- nenhum trusted origin remoto aprovado.

A aplicação já possui uma segunda barreira independente em `AuthGate.tsx`: `emailVerified !== true` bloqueia todos os módulos e dados.

## Mudanças já aplicadas por API oficial
- DEV application name: `iFarm Security DEV`;
- STAGE application name: `iFarm Security STAGE`.

Nenhuma alteração foi feita em PROD.

## Contrato alvo para DEV
- email/password habilitado;
- sign-up público desabilitado;
- verificação de e-mail obrigatória;
- método de verificação `otp`;
- envio de verificação durante tentativa de sign-in quando necessário;
- localhost pode permanecer habilitado exclusivamente em DEV;
- sem OAuth social compartilhado.

## Contrato alvo para STAGE
- email/password habilitado;
- sign-up público desabilitado;
- verificação de e-mail obrigatória;
- método `otp` enquanto o ambiente utilizar o SMTP compartilhado para QA;
- somente origem HTTPS real do frontend STAGE em trusted domains;
- localhost desabilitado;
- sem OAuth social compartilhado;
- SMTP próprio antes de usuários reais/produção.

## Caminho oficial Neon
A documentação oficial do Neon CLI 2.23.0+ expõe:

```bash
neon neon-auth config email-password update \
  --enabled \
  --disable-sign-up \
  --require-email-verification \
  --email-verification-method otp \
  --send-verification-email-on-sign-in
```

Para STAGE, depois de existir uma origem real e pertencente ao projeto:

```bash
neon neon-auth domain add https://<stage-host>
neon neon-auth domain allow-localhost disable
```

O mesmo contrato existe na Neon API por `PATCH /projects/{project_id}/branches/{branch_id}/auth/email_and_password` e `PATCH .../auth/allow_localhost`.

## Automação isolada
`scripts/auth-provider-hardening.sh`:
- aceita somente `dev` ou `stage`;
- recusa `prod`, `production` e `main`;
- usa somente project/branch IDs exclusivos do iFarm Security;
- requer `IFARM_SECURITY_NEON_API_KEY`;
- não imprime a credencial;
- usa apenas comandos oficiais Neon CLI;
- exige origem HTTPS real para STAGE;
- recusa localhost/127.0.0.1 como origem STAGE.

`.github/workflows/auth-provider-hardening.yml` é somente `workflow_dispatch`, exige repositório privado **antes** de ler o secret dedicado e nunca recebe conexão Postgres privilegiada.

## Estado da execução
A automação de email/password e localhost **ainda não foi executada**, porque:
1. o repositório permanece público por decisão atual do projeto;
2. não existe `IFARM_SECURITY_NEON_API_KEY` dedicado disponível nesta sessão;
3. o conector Neon atual permite ler a configuração e alterar o nome da aplicação, mas não expõe os endpoints `email_and_password`/`allow_localhost` como ações mutáveis;
4. a origem Cloudflare STAGE real ainda não existe.

Esses bloqueios não são tratados como controles concluídos.

## MFA
Em 2026-09-14, o roadmap oficial do Managed Better Auth marca **MFA support como Coming soon**. Portanto:
- o iFarm Security não declara MFA de usuário final como implementado;
- o 2FA disponível para a conta do Neon Console não é confundido com MFA dos usuários do produto;
- `MFA strategy validated` continua bloqueio de produção/usuários reais;
- quando Managed Better Auth oferecer MFA suportado, deve existir nova SEC específica com UX, recovery, enrollment, auditoria e testes.

## E-mail
O SMTP compartilhado do Neon é aceitável apenas para desenvolvimento/QA com OTP. Antes de usuários reais:
- configurar SMTP próprio;
- validar entregabilidade;
- definir remetente do iFarm Security;
- testar verificação e reset de senha;
- revisar retenção/logs de envio conforme LGPD e contratos.

## Critérios de aceite
1. aplicação continua sem fluxo `.signUp`;
2. `AuthGate` continua bloqueando `emailVerified !== true`;
3. automação usa somente API/CLI oficial Neon;
4. PROD não aparece como destino permitido;
5. secret dedicado é obrigatório e nunca commitado;
6. STAGE exige origem HTTPS real antes de remover localhost;
7. não há edição direta de `neon_auth.project_config`;
8. não se declara MFA enquanto provider não suportar;
9. CI valida o contrato estático da automação;
10. estado live pendente permanece documentado até execução e leitura pós-hardening.
