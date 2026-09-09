# SEC-100 — Operations / SOC interno

## Objetivo
Consolidar saúde da rede, sinais de atenção, SOS, incidentes e manutenção para perfis operacionais autorizados.

## Importante
O painel não presume serviço humano de monitoramento 24×7. `human_monitoring_assumed=false` e `public_dispatch_enabled=false` são retornados pelo backend nesta fase.

## Perfis
- Admin iFarm;
- Admin Organização;
- Admin Bairro no seu bairro;
- Monitoramento somente quando houver membership ativo e escopo configurado.

Técnicos continuam usando suas permissões de manutenção e não recebem automaticamente a visão SOC sensível.

## Indicadores
- dispositivos totais/offline/degradados;
- eventos Alto/Crítico não reconhecidos;
- eventos aguardando validação humana;
- incidentes ativos e críticos;
- SOS ativos;
- manutenção comunitária aberta;
- saúde de rede agregada por bairro.

## Fila de atenção
A fila une SOS, incidentes, eventos Alto/Crítico, dispositivos offline/degradados e manutenção Alta/Crítica. O feed é sanitizado e filtrado por escopo no PostgreSQL.

## Fora do escopo
- despacho automático de autoridade;
- promessa de vigilância humana;
- integração governamental;
- biometria;
- SLA comercial ainda não contratado.
