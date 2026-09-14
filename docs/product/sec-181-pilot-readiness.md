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

Status:
- `draft`;
- `readiness`;
- `active`;
- `paused`;
- `completed`;
- `cancelled`.

`target_property_count` é limitado entre 5 e 10.

### `pilot_properties`
Relaciona propriedades convidadas ao piloto.

Participação:
- `invited`;
- `confirmed`;
- `declined`;
- `removed`.

Instalação:
- `pending`;
- `scheduled`;
- `installed`;
- `validated`.

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
- Monitoramento no próprio bairro.

Essa leitura não concede acesso direto a câmera privada, gravação, Evidence Vault ou dados de outra propriedade.

### Confirmação da propriedade
Somente Owner ativo da própria propriedade convidada.

### Instalação
Admin autorizado ou Técnico com membership ativo da propriedade confirmada.

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
10. Admin Bairro/Monitoramento têm somente visão agregada autorizada;
11. DEV → STAGE antes de qualquer avanço;
12. PROD permanece intocado nesta fase.
