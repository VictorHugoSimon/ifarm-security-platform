# Central de Eventos e Alertas — SEC-040 / SEC-043

## Princípios
Evento é um sinal operacional. IA não é prova definitiva e não dispara ação automática por correspondência/classificação.

Fluxo:
`Origem → security_events → severidade → reconhecimento → validação humana quando aplicável → alerta → incidente (fase seguinte)`

## Severidades
- Informativo
- Atenção
- Alto
- Crítico

## Validação humana
Eventos de infraestrutura, como `device.offline`, podem entrar como `not_required`.
Eventos de IA que exigem revisão permanecem `pending` até um usuário autorizado escolher `confirmed` ou `rejected`.

Cada reconhecimento/validação gera uma linha em `event_actions`. A origem do evento não é sobrescrita.

## Community x Private
A leitura de eventos usa `app_has_scope_access()`.
Regras de alerta de bairro só correspondem a eventos comunitários (`property_id IS NULL`). Uma regra de bairro não captura evento privado da fazenda.
Regra de propriedade só recebe eventos daquela propriedade.
Regra organizacional inteira exige Admin da Organização ou Admin iFarm.

## Alertas
O usuário cria suas próprias assinaturas com:
- escopo;
- tipo de evento opcional;
- severidade mínima;
- canal.

Canais modelados: `app`, `push`, `email`, `sms`, `whatsapp`.

Nesta fase:
- `app` → status `queued`;
- push/e-mail/SMS/WhatsApp → status `blocked_external`.

Nenhum canal externo será enviado antes de provedor homologado, contrato/configuração específica, secrets exclusivos e validação de privacidade/LGPD.

## Correção de segurança em alerts
A política de leitura de `alerts` foi endurecida: além da organização/destinatário, ela revalida o escopo do evento ou incidente original. Isso impede que um alerta sem destinatário amplie o acesso a um evento privado.

## Próxima fase
SEC-050 Incident Center:
- promover evento(s) a incidente;
- timeline;
- responsável;
- evidências;
- status;
- ações;
- auditoria;
- iFarm SOS em jornada separada.
