# SEC-175 — Gestão de convites e acessos

Data de referência: 2026-09-10.

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
- revogação é lógica (`revoked`), nunca delete;
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

## Aceite de segurança
Testar com a matriz sintética SEC-150:
1. Admin Organização cria convite de Owner/Família para Fazenda A;
2. Admin Bairro cria Técnico/Monitoramento comunitário;
3. Admin Bairro é bloqueado ao tentar qualquer convite para Fazenda A/B;
4. Owner A cria Família/Técnico somente em A;
5. Owner A é bloqueado em B e ao tentar Admin Bairro/Admin Organização;
6. Técnico/Família/Monitoramento não criam convites;
7. papéis `admin_ifarm`, `authorized_authority`, `insurance_partner` são rejeitados;
8. `anonymous` não executa as RPCs;
9. tabela mantém zero grants diretos de browser;
10. revogação gera status e auditoria sem delete.

Aplicar DEV primeiro, depois STAGE. PROD permanece intocado.
