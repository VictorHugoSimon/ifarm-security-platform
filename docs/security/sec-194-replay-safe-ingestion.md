# SEC-194 — Replay-Safe Ingestion

## Objetivo
Garantir que conectividade rural instável, buffer local e retransmissões não dupliquem telemetria/eventos nem façam o estado operacional voltar no tempo.

## Contrato
Toda ingestão externa precisa de `eventId` estável e único na origem:
- heartbeat: unicidade por `(device_id, event_id)`;
- posição de ativo: unicidade por `(asset_id, source_event_id)`.

Ausência, vazio ou valor acima de 128 caracteres é rejeitado como `invalid_event_id`, que a API converte em resposta 400 sanitizada.

## Heartbeat
A SEC-194 substitui o padrão antigo `SELECT → INSERT`, que tinha janela de corrida entre retransmissões concorrentes, por `INSERT ... ON CONFLICT DO NOTHING`.

Resultado de replay:
- `accepted=false`;
- `transition=duplicate`;
- nenhuma nova transição de status;
- nenhum novo `security_event`.

O estado do dispositivo é serializado com lock por dispositivo. Se um heartbeat contém `sourceAt` anterior a telemetria já observada, a amostra continua registrada para histórico, mas retorna `transition=historical` e não altera `devices.status`, `last_seen_at` ou eventos de status.

## Asset Security
O fluxo GPS já possuía deduplicação parcial. A SEC-194 torna `eventId` obrigatório e serializa a atualização por ativo para impedir corridas na geofence.

Posições com `recordedAt` anterior a `last_position_at` continuam registradas, mas recebem `transition=historical` e não alteram localização/geofence atuais.

## Segurança
- As RPCs continuam `SECURITY DEFINER` apenas para o backend de ingestão e sem EXECUTE para `PUBLIC`, `anonymous` ou `authenticated`.
- Device key continua validada antes de mutação de estado.
- O event ID não é segredo; é identificador técnico de idempotência e não deve conter dado pessoal.
- A deduplicação não transforma IA em prova e não altera os fluxos de validação humana.

## Requisito para Edge/Gateway
O originador deve gerar o `eventId` **uma vez**, antes de gravar no buffer local, e reutilizar exatamente o mesmo identificador em todos os retries. Gerar novo ID a cada retransmissão derrota a idempotência.

Sugestão de formato: UUID v4 ou identificador opaco equivalente com no máximo 128 caracteres. Não incluir placa, CPF, nome, coordenadas ou outro dado pessoal no ID.

## Aceite
1. heartbeat concorrente usa `ON CONFLICT`, não consulta prévia como mecanismo de deduplicação;
2. heartbeat e GPS rejeitam ausência de event ID;
3. duplicate retorna `accepted=false`;
4. replay não gera segunda transição/evento;
5. heartbeat histórico não volta o status atual no tempo;
6. posição histórica não volta localização/geofence no tempo;
7. locks são por dispositivo/ativo, não globais;
8. RPCs continuam fora dos roles do browser;
9. aplicar DEV → validar → STAGE; PROD não participa desta entrega.
