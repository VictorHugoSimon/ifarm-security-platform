# iFarm Asset Security — SEC-070

## Escopo
Cadastro de máquinas, implementos, veículos e equipamentos vinculados a uma propriedade privada. Inclui GPS opcional, localização atual, histórico, geofence, documentos (metadados) e manutenção.

## GPS e conectividade rural
O GPS usa a mesma identidade de máquina já existente em `device_ingest_keys`. O endpoint aceita `eventId` para deduplicação. Posições recebidas fora de ordem entram no histórico, mas não sobrescrevem a posição atual nem mudam a geofence retroativamente.

## Geofence
- Polígono PostGIS ou círculo por centro + raio.
- `inside → outside`: evento `asset_geofence_exit`, severidade `high`.
- `outside → inside`: `asset_geofence_return`, informativo.
- primeira posição já fora: `asset_geofence_outside_detected`, atenção.
- eventos são regras técnicas com `human_validation_status=not_required`; não são prova de furto.

## Documentos
Nesta fase são apenas metadados e vencimentos. `storage_status=not_configured`; nenhum upload ou URL pública.

## Manutenção
Planejada, em andamento, concluída ou cancelada. Pode alterar o ativo para `maintenance` enquanto o serviço está em andamento.

## Insurance
Integração com iFarm Insurance é fase posterior e exige autorização para uso dos dados de Security. Asset Security não presume cobertura securitária.
