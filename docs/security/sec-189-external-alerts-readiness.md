# SEC-189 — External Alerts Provider Readiness

Data de referência: 2026-09-15.

## Objetivo
Preparar push, e-mail, SMS e WhatsApp para futura homologação sem permitir que configuração incompleta, bug ou operador trate um canal externo como disponível antes de existir provider oficial/autorizado, credencial dedicada, consentimento e testes.

## Estado atual
- canal `app`: interno e disponível;
- `push`: `blocked_external`;
- `email`: `blocked_external`;
- `sms`: `blocked_external`;
- `whatsapp`: `blocked_external`;
- dispatcher externo: não implementado;
- provider externo contratado/homologado: nenhum;
- credencial externa: nenhuma criada ou reutilizada nesta frente.

A migration 0028 adiciona um catálogo de readiness **sem secrets**. O catálogo não ativa entrega. Uma constraint separada em `alerts` obriga todos os canais externos a permanecerem em `blocked_external` nesta fase.

## Princípios
1. Segredos ficam somente server-side e fora do banco/frontend.
2. Nenhum token de outro projeto pode ser reutilizado.
3. Cada entrega futura deve preservar dedupe, tentativas, erro sanitizado, provider e `provider_message_id`.
4. Contato/destinatário deve estar autorizado, válido e compatível com consentimento/finalidade.
5. Templates e conteúdo devem identificar que alertas de IA são detecções/classificações sujeitas a validação humana; nunca prova definitiva.
6. WhatsApp somente via solução oficial/homologada e conforme regras do provider.
7. Alerta externo não significa monitoramento humano 24x7.
8. Alerta externo não significa despacho automático para polícia, bombeiros ou autoridade pública.
9. iFarm SOS continua interno enquanto não houver integração oficial formalmente validada.

## Catálogo de provider
`alert_delivery_providers` contém somente metadados operacionais:
- canal;
- identificador lógico do provider;
- modo `blocked | test | live`;
- `enabled`;
- referência não secreta de remetente;
- nota operacional/timestamp.

A tabela não armazena senha, token, API key, WABA token, chave privada, SMTP password ou credential payload. O browser não tem SELECT/DML direto.

A RPC `get_external_alert_provider_status()` retorna somente:
- canal;
- `configured` boolean;
- modo.

Nenhuma credencial, telefone, sender secret ou configuração sensível é retornada.

## Fail-closed no banco
Enquanto existir `alerts_external_delivery_fail_closed`:
- `app` pode seguir seu fluxo interno;
- `push/email/sms/whatsapp` só podem ter status `blocked_external`;
- provider/message id/timestamps de entrega devem permanecer nulos para canais externos.

Para habilitar entrega externa no futuro será obrigatória uma nova migration explícita, acompanhada do dispatcher server-side e testes.

## Gate antes de liberar qualquer canal externo
- provider selecionado e autorizado contratualmente;
- secret dedicado do iFarm Security em secret manager/ambiente server-side;
- consentimento/finalidade e contato verificados;
- template/conteúdo revisado;
- dedupe, retry, rate limit e idempotência testados;
- receipt/status do provider auditável;
- runbook de falha/incidente aprovado;
- validação jurídica/DPO quando envolver dados pessoais, imagem ou WhatsApp/SMS conforme contexto.

## WhatsApp
Não reutilizar WABA, app Meta, token, Phone Number ID ou System User de outros projetos. Um futuro provider WhatsApp precisa ser criado/homologado especificamente para iFarm Security, com responsabilidades e custos definidos.

## E-mail
O provider de e-mail de alertas operacionais é separado conceitualmente do SMTP de autenticação do Neon. Não assumir que o mesmo domínio/credencial/provider será compartilhado.

## SMS / Push
Provider ainda não selecionado. Antes da seleção avaliar cobertura rural, custo, SLA do provider, entrega/receipt, privacidade, rate limit e suporte no Brasil.

## Produção
`externalDeliveryAllowed=false` até todos os gates estarem aprovados. Não apresentar canal externo como ativo em proposta comercial antes da homologação técnica/contratual correspondente.
