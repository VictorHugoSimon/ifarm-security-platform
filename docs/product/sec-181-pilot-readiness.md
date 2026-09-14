# SEC-181 — Pilot Readiness & Observability

Data de referência: 2026-09-14.

## Objetivo
Preparar o iFarm Security para um piloto controlado de **1 bairro rural + 5 a 10 propriedades**, medindo conectividade, saúde dos dispositivos, fluxo de eventos, instalação, experiência, custo e potencial de receita.

O Pilot Center não comprova prevenção de crimes e não presume operação humana 24×7, integração pública ou despacho de autoridades.

## Princípios
1. piloto só pode ser ativado com 5–10 propriedades confirmadas;
2. convite administrativo não confirma participação;
3. confirmação da propriedade é feita por Owner ativo da própria propriedade;
4. métricas `system` são derivadas somente de dados existentes no iFarm Security;
5. métricas `manual` permanecem explicitamente marcadas como manuais;
6. evento rejeitado em validação humana não é automaticamente classificado como falso positivo;
7. Pilot Center não expõe streams, storage keys, gravações ou Evidence Vault;
8. Community e propriedade privada continuam segregados.

## Estrutura
### `pilot_programs`
Programa do piloto por organização/bairro.

Status: `draft`, `readiness`, `active`, `paused`, `completed`, `cancelled`.

`target_property_count` é limitado entre 5 e 10.

### `pilot_properties`
Relaciona propriedades convidadas ao piloto.

Participação: `invited`, `confirmed`, `declined`, `removed`.

Instalação: `pending`, `scheduled`, `installed`, `validated`.

A confirmação grava `confirmed_by_user_id` e `confirmed_at`.

### `pilot_system_snapshots`
Snapshot objetivo obtido pelo backend.

Mede:
- dispositivos no escopo;
- dispositivos online no momento;
- heartbeat recente conforme `offline_after_seconds` de cada dispositivo;
- eventos nas últimas 24 horas;
- eventos com validação encerrada;
- eventos rejeitados;
- tempo médio de validação humana.

O escopo inclui apenas:
- dispositivos comunitários do bairro com `property_id IS NULL` e `community_shared=true`;
- dispositivos privados das propriedades confirmadas no piloto;
- eventos comunitários do bairro;
- eventos das propriedades confirmadas.

### `pilot_manual_observations`
Métricas cuja origem ainda depende de pesquisa, planilha, vistoria ou fonte externa.

Chaves iniciais:
- uptime de conectividade;
- sucesso de entrega de vídeo;
- taxa de falsos positivos classificada manualmente;
- tempo médio de instalação;
- experiência do usuário (1–5);
- custo operacional mensal;
- MRR potencial.

`source_kind='manual'` é imposto por constraint.

## RBAC
### Gestão do piloto
- Admin iFarm;
- Admin Organização da própria organização.

### Leitura agregada
- Admin iFarm;
- Admin Organização;
- Admin Bairro no próprio bairro;
- Monitoramento quando possuir membership de bairro (`property_id IS NULL`).

Essa leitura não concede acesso direto a câmera privada, gravação, Evidence Vault ou dados de outra propriedade. Um perfil de Monitoramento limitado a uma propriedade não recebe automaticamente visão agregada do bairro.

### Confirmação da propriedade
Somente Owner ativo da própria propriedade convidada.

### Instalação
Admin autorizado ou Técnico com membership ativo da propriedade confirmada. Técnico somente comunitário não administra instalação privada.

## Ativação
`active` exige de 5 a 10 propriedades com `participation_status='confirmed'`.

Atingir essa faixa significa apenas que o critério de participantes foi atendido. Não significa que o piloto está tecnicamente aprovado para produção, que a conectividade é suficiente ou que existe SLA.

## KPIs recomendados para o piloto
### Sistêmicos
- dispositivos online agora;
- heartbeat recente;
- taxa de validação de eventos em 24h;
- eventos rejeitados em 24h;
- tempo médio de validação humana.

### Manuais
- uptime de conectividade no período;
- entrega de vídeo;
- falso positivo validado por metodologia definida;
- tempo de instalação;
- experiência do proprietário;
- custo operacional;
- MRR potencial.

### KPIs comerciais/operacionais para decisão Go/No-Go
Definir antes do piloto real:
- propriedades confirmadas;
- propriedades instaladas/validadas;
- disponibilidade técnica mínima;
- volume de alertas por propriedade;
- carga de suporte;
- taxa de chamados por dispositivo;
- CAC de implantação;
- CAPEX por propriedade/bairro;
- MRR potencial;
- margem de hardware/instalação/SaaS;
- intenção de contratação após piloto.

Metas numéricas finais devem ser aprovadas pela governança comercial/operacional; o sistema não inventa metas quando elas ainda não existem.

## UI
Rota `#/pilot`:
- criação de piloto;
- lista de pilotos visíveis;
- convite de propriedade;
- confirmação pelo Owner;
- status de instalação;
- snapshot sistêmico;
- métricas agregadas;
- observações manuais;
- transição de readiness/active/paused.

## Auditoria
Eventos:
- `pilot.program.created`;
- `pilot.property.invited`;
- `pilot.property.confirmed`;
- `pilot.program.status_changed`.

## Evidência de validação DEV/STAGE — 2026-09-14
### DEV
Migration `0024_pilot_readiness.sql` aplicada. Resultado:
- 4 tabelas de piloto presentes;
- RLS ativo nas 4;
- `authenticated` sem SELECT direto em `pilot_programs`;
- RPCs de piloto executáveis por `authenticated`;
- `anonymous` sem execução das RPCs;
- constraint de 5–10 propriedades presente;
- constraint `source_kind='manual'` presente.

### STAGE
A mesma migration foi promovida para STAGE após CI #49 100% verde.

Fixture não destrutivo mantido de forma explícita:
- piloto: `QA-SEC181 Piloto Bairro Rural`;
- organização/bairro: fixtures `QA-SEC150` existentes;
- Fazenda A convidada e confirmada pelo Owner A;
- Fazenda B convidada, mas não confirmada;
- uma observação manual sintética de MRR (`R$ 2.500`) permanece marcada `source_kind=manual`;
- um snapshot sistêmico permanece associado ao piloto.

Validações observadas:
- Owner A visualizou somente o convite da Fazenda A;
- Owner A confirmou Fazenda A;
- tentativa do Owner A de confirmar Fazenda B foi bloqueada por `pilot_owner_confirmation_required`;
- Admin Bairro visualizou o piloto apenas pela visão agregada;
- Owner A não recebeu visão agregada do Pilot Center (`0` pilotos em `list_pilot_programs`);
- snapshot sistêmico contou exatamente 2 dispositivos: câmera comunitária + câmera privada da Fazenda A confirmada;
- snapshot retornou `online_device_count=2` e `recent_heartbeat_count=0` conforme estado existente dos fixtures, sem inventar uptime histórico;
- observação de MRR permaneceu `source_kind=manual`;
- tentativa de ativar o piloto com apenas 1 propriedade confirmada foi bloqueada por `pilot_active_requires_5_to_10_confirmed_properties`;
- Admin Bairro não conseguiu registrar KPI manual (`pilot_manual_metric_management_not_allowed`);
- Técnico com membership apenas comunitário não conseguiu alterar instalação da Fazenda A (`pilot_installation_management_not_allowed`).

Nenhum dado real de cliente foi usado. PROD não recebeu a migration.

## Critérios de aceite
1. 5–10 propriedades como faixa estrutural do piloto;
2. ativação bloqueada com menos de 5 ou mais de 10 confirmadas;
3. Owner confirma somente a própria propriedade;
4. nenhuma tabela-base de piloto acessível diretamente pelo browser;
5. `anonymous` não executa RPCs;
6. métricas sistêmicas vêm de `devices` e `security_events` existentes;
7. métricas manuais têm `source_kind=manual` obrigatório;
8. evento rejeitado não é automaticamente tratado como falso positivo;
9. nenhuma exposição de Evidence Vault/storage/gravação;
10. Admin Bairro/Monitoramento têm somente visão agregada autorizada conforme o escopo do membership;
11. DEV → STAGE antes de qualquer avanço;
12. PROD permanece intocado nesta fase.
