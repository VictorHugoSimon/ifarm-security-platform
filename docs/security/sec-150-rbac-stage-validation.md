# SEC-150 — Matriz RBAC sintética no STAGE

Data de referência: 2026-09-09.

## Objetivo
Validar com sessões `authenticated` que os limites entre bairro rural, propriedades privadas e funções operacionais permanecem isolados antes de qualquer uso real do STAGE.

## Escopo do teste
Foram criados exclusivamente no STAGE usuários e dados sintéticos prefixados com `QA-SEC150`. Não foram usados clientes, câmeras, credenciais, vídeos, evidências ou propriedades reais.

Cenário:
- 1 organização sintética;
- 1 bairro rural sintético;
- Fazenda A e Fazenda B;
- 1 câmera comunitária do bairro;
- 1 câmera privada da Fazenda A;
- 1 câmera privada da Fazenda B;
- perfis: Admin Organização, Admin Bairro, Proprietário A, Família A, Técnico de Bairro e Monitoramento A.

## Método
A identidade foi simulada somente em transações de QA usando `request.jwt.claims`, carregada antes de `SET LOCAL ROLE authenticated`. O schema `auth` continuou sem `USAGE` direto para `authenticated`; nenhuma permissão foi aberta e nenhum bypass de autenticação foi criado.

## Resultado observado

| Perfil | Câmera comunitária | Privada A | Privada B | Gerencia bairro | Gerencia A | Gerencia B |
|---|---:|---:|---:|---:|---:|---:|
| Admin Organização | Sim | Sim | Sim | Sim | Sim | Sim |
| Admin Bairro | Sim | Não | Não | Sim | Não | Não |
| Proprietário A | Sim | Sim | Não | Não | Sim | Não |
| Família A | Sim | Sim | Não | Não | Não | Não |
| Técnico de Bairro | Sim | Não | Não | Sim | Não | Não |
| Monitoramento A | Sim | Sim | Não | Não | Não | Não |

## Critérios críticos aprovados
- Admin Bairro não herdou acesso a câmera privada de nenhuma propriedade.
- Técnico com escopo de bairro não herdou acesso privado.
- Proprietário, Família e Monitoramento da Fazenda A não visualizaram a câmera privada da Fazenda B.
- Família e Monitoramento não receberam poder de gestão da propriedade.
- Proprietário A gerencia somente a Fazenda A.
- Admin Organização manteve a visão organizacional prevista.
- Não foi observado vazamento lateral entre Fazenda A e Fazenda B.

## Gate estático
A CI passa a executar `pnpm rbac:check`, que protege os invariantes abaixo contra regressão acidental no SQL versionado:
- acesso privado exige `property_id` correspondente;
- Admin Bairro não pode gerenciar propriedade privada;
- heartbeat de dispositivo não pode ser chamado pelo role normal do portal;
- Community mantém `private_device_sharing_allowed=false`;
- caminho até a propriedade aceita apenas câmera comunitária;
- Operations/SOC mantém `human_monitoring_assumed=false` e `public_dispatch_enabled=false`;
- `authenticated` não pode escrever nos metadados PostGIS endurecidos pela SEC-140.

## Estado após SEC-150
STAGE contém somente este fixture sintético de regressão e continua sem dados reais. PROD permanece fora do escopo e não recebe migrations nem dados nesta etapa.
