# SEC-175 — Gestão de convites e acessos

Data de referência: 2026-09-11.

## Objetivo
Criar uma superfície vendável e auditável para delegação de acessos tenant sem permitir escalada de privilégio ou mistura entre área comunitária e propriedade privada.

## Papéis permitidos no convite genérico
- `admin_organization`
- `admin_neighborhood`
- `owner`
- `family`
- `employee`
- `technician`
- `monitoring`

## Papéis proibidos no convite genérico
- `admin_ifarm`: somente processo administrativo da plataforma/Neon Auth;
- `authorized_authority`: integração institucional futura, com autorização formal, base legal, contrato/convênio e acesso mínimo;
- `insurance_partner`: onboarding separado de parceiro, com regras de finalidade e consentimento.

A própria constraint da tabela exclui esses três papéis e `claim_my_invited_access()` repete a allowlist como defesa em profundidade.

## Matriz de delegação
- Admin iFarm: pode criar Admin Organização e papéis tenant inferiores, respeitando o escopo exigido pelo papel.
- Admin Organização: pode criar Admin Bairro e papéis de propriedade/operação dentro da própria organização; não cria outro Admin Organização.
- Admin Bairro: pode convidar somente `technician` e `monitoring` no próprio bairro, com `property_id IS NULL`. Nunca delega acesso privado.
- Proprietário: pode convidar `family`, `employee`, `technician` e `monitoring` somente na própria propriedade.
- Família, Funcionário, Técnico e Monitoramento: não delegam acessos.

## Regras do convite
- e-mail normalizado em lowercase;
- validade mínima superior a 15 minutos e máxima de 30 dias;
- padrão da UI: 7 dias;
- um único convite `pending` por organização + bairro + propriedade + e-mail + papel;
- convite vencido não pode ser reivindicado;
- membership já ativo no mesmo papel/escopo bloqueia novo convite;
- revogação é lógica (`revoked`), nunca delete no fluxo do produto;
- `revoked_at` e `revoked_by_user_id` são registrados;
- audit log registra somente SHA-256 do e-mail, não o endereço em claro.

## Superfície de dados
A tabela `access_invitations` contém PII necessária para o claim por e-mail e não é exposta diretamente ao browser. `PUBLIC`, `anonymous` e `authenticated` não possuem acesso direto à tabela.

RPCs autenticadas:
- `create_access_invitation`
- `list_access_invitations`
- `revoke_access_invitation`
- `claim_my_invited_access`

O helper `app_can_delegate_invitation` é interno e não recebe grant de execução para browser roles.

## UI
`AccessManagement.tsx` permite criar, listar e revogar convites. A interface oferece organização, papel, escopo e validade, mas a autorização final sempre é do banco. Mensagens de erro não transformam falha de autorização em acesso.

## Evidência de validação
A migration `0019_access_invitations.sql` foi aplicada primeiro em DEV e depois em STAGE. PROD não foi alterado.

DEV pós-migration:
- `revoked_at` e `revoked_by_user_id`: 2/2 colunas presentes;
- índice parcial `ux_access_invitations_pending_scope`: presente;
- quatro funções principais confirmadas como `SECURITY DEFINER`;
- `authenticated` possui EXECUTE nas RPCs aprovadas;
- `anonymous` não executa `create_access_invitation`;
- `authenticated` e `anonymous` permanecem sem DML direto em `access_invitations`.

O DEV está vazio por desenho, sem identidades persistidas, então os caminhos positivos de RBAC foram executados no STAGE usando exclusivamente os fixtures sintéticos SEC-150 já existentes.

Matriz STAGE, uma identidade/JWT por transação:
- Admin Organização: pode delegar Técnico comunitário e Owner de propriedade; não pode criar outro Admin Organização; não pode criar Autoridade;
- Admin Bairro: pode delegar Técnico/Monitoramento comunitário; não pode delegar acesso privado nem novo Admin Bairro;
- Owner Fazenda A: pode delegar Família/Funcionário/Técnico na Fazenda A; não pode delegar Família na Fazenda B nem outro Owner;
- Família Fazenda A: não delega Funcionário nem Monitoramento;
- Técnico comunitário: não delega Monitoramento nem Família;
- Monitoramento Fazenda A: não delega Família nem Técnico.

Um primeiro teste que trocou múltiplos JWTs dentro da mesma transação gerou um resultado inconsistente para Admin Organização por causa do contexto de sessão JWT estável. Esse cenário não representa o Data API real. O teste foi repetido corretamente com uma identidade por transação e passou conforme a matriz acima.

Smoke real das RPCs no STAGE, com role `authenticated` e Owner Fazenda A:
1. `create_access_invitation` criou convite sintético de `family` para Fazenda A;
2. `list_access_invitations` retornou o convite somente no escopo permitido;
3. `revoke_access_invitation` alterou o convite para revogado com sucesso;
4. o convite e os audit logs criados exclusivamente pelo smoke foram removidos após o teste;
5. ficaram **0** registros do endereço sintético usado no smoke.

## Aceite de segurança
Validado:
1. Admin Organização delega papéis inferiores no próprio tenant;
2. Admin Bairro delega apenas Técnico/Monitoramento comunitário;
3. Admin Bairro é bloqueado em propriedade privada;
4. Owner A delega Família/Funcionário/Técnico somente em A;
5. Owner A é bloqueado em B e ao tentar delegar Owner;
6. Técnico/Família/Monitoramento não criam convites;
7. papéis `admin_ifarm`, `authorized_authority`, `insurance_partner` ficam fora do convite genérico;
8. `anonymous` não executa a RPC de criação;
9. tabela mantém zero grants diretos de browser;
10. revogação lógica e auditoria foram exercitadas via RPC real.

DEV e STAGE validados. PROD permanece intocado.
