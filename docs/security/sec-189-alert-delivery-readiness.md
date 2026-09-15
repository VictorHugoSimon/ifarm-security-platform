# SEC-189 — Alert Delivery Readiness

Data de referência: 2026-09-15.

## Estado atual
- O canal interno `app` permanece disponível no próprio portal.
- Regras de alerta aceitam `push`, `email`, `sms` e `whatsapp`, porém esses canais entram em `blocked_external`.
- Nenhum provedor externo foi homologado ou configurado.
- Nenhum secret de provedor externo existe no frontend.
- Nenhum worker de entrega externa foi implantado.
- Não há suposição de monitoramento humano 24x7 nem despacho público automático.

## Contrato de arquitetura
1. `app` é canal interno da plataforma e não depende de provedor externo.
2. `push/email/sms/whatsapp` permanecem bloqueados até o gate de produção ser aprovado.
3. Credenciais de provedor são exclusivamente server-side e dedicadas ao iFarm Security.
4. Nenhum token, API key ou segredo de mensageria entra em Vite/browser.
5. Entrega externa precisa preservar `dedupe_key` e registrar `provider_message_id` antes de ser considerada concluída.
6. Retry deve ter backoff e limite de tentativas; alvo inicial máximo: 5 tentativas.
7. Falha de entrega nunca transforma um evento em incidente nem presume crime.
8. WhatsApp só pode usar provedor/API homologada e fluxo permitido pelo provedor.
9. SMS/e-mail/push devem respeitar consentimento, finalidade e preferência do destinatário conforme política aplicável.
10. Integrações governamentais, biometria e despacho público permanecem fora deste fluxo.

## Gate de produção
Enquanto `externalDelivery.configured=false`, nenhum envio externo real é permitido. Antes de liberar qualquer canal externo:
- contrato/provedor aprovado;
- credenciais dedicadas server-side;
- worker de entrega implantado;
- retry/backoff testado;
- deduplicação testada;
- `provider_message_id` persistido;
- isolamento de destinatários entre tenants testado;
- consentimento/base legal e opt-in validados quando aplicável;
- observabilidade de falha/latência/entrega validada;
- runbook de incidentes do provedor definido.

## Canais
### App
Disponível internamente. O alerta fica acessível no feed do usuário conforme RBAC/RLS.

### Push
Future-ready. Requer provedor e registro seguro de dispositivo/token de push; nenhum token deve ser compartilhado entre tenants.

### E-mail
Future-ready. Requer provedor dedicado e política de remetente, bounce, retry e opt-out quando aplicável.

### SMS
Future-ready. Requer provedor dedicado, custo controlado, consentimento e limites anti-abuso.

### WhatsApp
Future-ready. Exige API/provedor homologado, templates/consentimentos quando exigidos e número remetente exclusivo autorizado. Não reutilizar WABA, token ou Phone Number ID de outro projeto.

## Observabilidade mínima futura
Para cada tentativa externa registrar, sem corpo sensível desnecessário:
- alert_id;
- channel;
- attempt_count;
- provider;
- provider_message_id após aceite;
- status normalizado;
- error_code sanitizado;
- timestamps de tentativa/aceite/falha.

## Estado de segurança
`externalDeliveryAllowed=false` permanece obrigatório neste estágio. O sistema não deve trocar `blocked_external` por `queued` ou `sent` para canais externos sem que o gate seja revisado e testado.
