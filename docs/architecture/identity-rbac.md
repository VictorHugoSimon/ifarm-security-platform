# Identity, RBAC e Multi-tenant — SEC-002/003/004

## Decisão
O portal usa Neon Auth para identidade e Neon Data API para consultas autenticadas. O PostgreSQL aplica RLS como segunda barreira de autorização. A API Hono permanece responsável por ingestão de eventos, integrações, comandos e escritas privilegiadas/auditáveis.

## Fluxo de acesso
1. Usuário autentica no Neon Auth.
2. Usuário não recebe acesso ao tenant apenas por possuir conta.
3. A função `claim_my_invited_access()` exige e-mail verificado e convite pendente válido.
4. O convite cria/ativa `app_users` e `memberships`.
5. Consultas do portal passam pelo Data API e RLS.
6. Sem membership ativa, o resultado é vazio/negado.

## Separação Community x Private
- Organização: acesso somente a membros da organização.
- Bairro/comunitário: membership do bairro ou administradores de organização.
- Propriedade privada: membership explícita da propriedade ou administradores de organização.
- Admin de bairro não recebe automaticamente acesso às câmeras privadas das propriedades.
- Gravações e evidências herdam o escopo do dispositivo/incidente de origem.

## Papéis iniciais
`admin_ifarm`, `admin_organization`, `admin_neighborhood`, `owner`, `family`, `employee`, `technician`, `monitoring`, `authorized_authority`, `insurance_partner`.

## Segurança
- Sem auto-cadastro no portal.
- Contas sem convite não acessam tenant.
- Convite exige e-mail verificado para ser reivindicado.
- MFA continua obrigatório no modelo de usuário e deve ser habilitado/configurado no provedor antes de produção.
- Data API permanece read-only por RLS no MVP; escritas de negócio passam pela API de serviço.
- STAGE/PROD não recebem a migration até homologação.
