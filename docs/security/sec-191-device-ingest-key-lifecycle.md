# SEC-191 — Device Ingest Key Lifecycle

Data de referência: 2026-09-15.

## Objetivo
Endurecer o ciclo de vida das credenciais usadas por câmeras, gateways, NVRs, GPS e sensores para enviar telemetria ao iFarm Security.

## Princípios
- A chave bruta é gerada no browser autorizado usando `crypto.getRandomValues`.
- A chave bruta é exibida somente no momento da geração e permanece apenas em memória do componente.
- `localStorage`, `sessionStorage`, banco, audit log e logs da API nunca recebem a chave bruta.
- Antes do RPC, o navegador calcula SHA-256; o banco recebe somente o hash de 64 caracteres.
- A API de ingestão recebe `Device <raw-key>`, calcula SHA-256 no Worker e compara somente o hash no Neon.
- O hash armazenado nunca é devolvido pelas RPCs de listagem.

## Validade
- Toda nova chave deve ter `expires_at`.
- Padrão operacional da UI: 90 dias.
- Opções do MVP: 30, 60, 90, 180 ou 365 dias.
- Banco bloqueia validade vencida ou acima de 365 dias.
- Chave vencida deixa de autenticar ingestão mesmo se o status físico ainda estiver `active`.
- A listagem sanitizada apresenta esse caso como estado efetivo `expired`.

## Rotação sem indisponibilidade
1. gerar uma nova chave antes da expiração da anterior;
2. configurar a nova chave no equipamento autorizado;
3. aguardar o equipamento enviar telemetria;
4. confirmar `last_used_at` da nova chave;
5. revogar a chave anterior;
6. ocultar o valor bruto da nova chave na UI.

O banco permite sobreposição temporária de chaves para evitar downtime durante a rotação, com limite máximo existente de 5 chaves ativas/não vencidas por dispositivo.

## Revogação
A revogação é imediata no banco e auditada. Após revogada, a chave deixa de autenticar novos heartbeats/GPS. O segredo bruto não é incluído na auditoria.

## Isolamento
- Community: somente perfis autorizados a gerenciar o dispositivo comunitário podem criar/listar/revogar chaves.
- Private: somente perfis autorizados a gerenciar a propriedade/dispositivo privado podem fazê-lo.
- Admin Bairro não recebe acesso automático a chaves de câmeras privadas.
- Usuário humano nunca executa a RPC de ingestão diretamente.

## Migração
`0028_device_ingest_key_lifecycle.sql`:
- torna `expires_at` obrigatório;
- adiciona constraints de hash, label e janela máxima;
- mantém a assinatura de `register_device_ingest_key` por compatibilidade;
- quando `p_expires_at` for nulo, aplica 90 dias no banco;
- limita explicitamente a 365 dias;
- mantém somente SHA-256 em persistência/auditoria;
- `list_device_ingest_keys` transforma chave vencida em status efetivo `expired` sem devolver hash.

## Critérios de aceite
- chave bruta nunca persistida;
- SHA-256 obrigatório;
- expiração obrigatória;
- máximo de 365 dias;
- revogação auditada;
- rotação pode ocorrer com pequena sobreposição;
- chave vencida não autentica ingestão;
- leitura de metadados não revela hash nem segredo;
- controles Community/Private permanecem intactos.
