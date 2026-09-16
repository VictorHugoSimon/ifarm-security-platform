# SEC-199 — Telemetry Delay & Clock Observability

Data de referência: 2026-09-16.

## Objetivo

Dar visibilidade operacional para atrasos de sincronização rural e qualidade temporal do edge/gateway sem transformar um sinal técnico em alegação de falha, adulteração ou crime.

A SEC-198 impede heartbeat atrasado de regredir o estado atual. A SEC-199 permite que a operação entenda **por que** existem heartbeats históricos.

## Classificação persistida

`device_telemetry.ingest_ordering` aceita somente:

- `legacy_unknown`: linha criada antes da SEC-199; não há tentativa de adivinhar retroativamente se foi corrente ou histórica;
- `current`: heartbeat classificado como corrente no instante da ingestão;
- `historical`: heartbeat aceito no histórico, mas impedido de alterar o estado atual pela SEC-198.

A classificação é atribuída server-side pelo ingest e não vem do dispositivo.

## Diagnósticos operacionais

A RPC `get_operations_telemetry_timing_health(p_hours)` usa janela limitada entre 1 e 168 horas e retorna somente agregados autorizados por dispositivo:

- quantidade de telemetrias;
- quantidade de heartbeats históricos;
- quantidade de mensagens cujo atraso superou o `offline_after_seconds` do próprio dispositivo (`buffered_rows`);
- quantidade de timestamps de origem mais de 60 segundos à frente do recebimento (`clock_ahead_rows`);
- quantidade sem `sourceAt` (`source_time_missing_rows`);
- maior atraso observado;
- último recebimento.

Não retorna:

- metadata;
- eventId;
- device key;
- payload bruto;
- gravações/evidências;
- conteúdo privado além do nome do dispositivo já autorizado ao perfil operacional.

## Autorização

A RPC reutiliza `app_has_operations_access`.

Portanto:

- Admin iFarm: escopo operacional permitido pela plataforma;
- Admin Organização: sua organização;
- Admin Bairro: apenas o bairro autorizado;
- Monitoring: somente escopos explicitamente atribuídos;
- demais perfis sem Operations/SOC não ganham acesso por causa da SEC-199.

A função não é executável por `PUBLIC` ou `anonymous`.

## Interpretação

Os indicadores são diagnósticos técnicos:

- `historical` pode significar sincronização de buffer após queda de conexão;
- `buffered` pode indicar fila local ou link lento/indisponível;
- `clock_ahead` pode indicar relógio/NTP incorreto;
- `sourceAt` ausente pode indicar firmware/protocolo sem timestamp confiável.

Nenhum desses sinais, isoladamente, comprova:

- sabotagem;
- invasão;
- falha física do equipamento;
- indisponibilidade real naquele instante;
- ocorrência criminal.

Não há criação automática de incidente ou despacho público a partir desses indicadores.

## UI

Operations/SOC passa a exibir “Sincronização / relógio · últimas 24h” somente para dispositivos com alguma atenção temporal no escopo autorizado.

A interface mantém aviso explícito de que diagnóstico temporal não é prova de falha/adulteração.

## Promoção

1. CI verde;
2. aplicar `0032` em DEV;
3. validar constraint/grants/RPC;
4. promover ao STAGE;
5. gerar heartbeat corrente e histórico QA pós-SEC-199;
6. comprovar agregados e isolamento de escopo;
7. registrar evidência;
8. CI final e merge.

PROD permanece fora desta etapa.
