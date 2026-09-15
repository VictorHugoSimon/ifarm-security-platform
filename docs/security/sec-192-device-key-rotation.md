# SEC-192 — Device Credential Lifecycle / Key Rotation

## Objetivo

Permitir rotação controlada das credenciais usadas por câmeras, gateways e dispositivos para enviar telemetria ao Worker do iFarm Security, sem armazenar segredo recuperável na plataforma.

## Princípios

- a chave bruta nunca é enviada ao banco;
- o navegador gera 256 bits aleatórios, monta o token `ifs_...` e envia somente SHA-256;
- o valor bruto é exibido uma única vez e não é salvo em `localStorage` ou `sessionStorage`;
- o banco nunca retorna hash ou chave bruta nas RPCs de listagem/rotação;
- logs de auditoria registram IDs e datas, nunca o segredo nem seu hash;
- a rotação não substitui um processo operacional de atualização do gateway/dispositivo.

## Fluxo de rotação

1. operador autorizado seleciona uma chave ativa;
2. frontend gera uma nova chave localmente;
3. SHA-256 da nova chave é enviado para `rotate_device_ingest_key`;
4. a nova credencial é registrada como sucessora da chave anterior;
5. a expiração da predecessora é reduzida para a janela de sobreposição;
6. durante a janela, chave antiga e nova podem autenticar ingestão;
7. ao vencer `expires_at`, a predecessora deixa automaticamente de autenticar nas RPCs de ingestão existentes;
8. operador copia a nova chave e atualiza o gateway/dispositivo autorizado.

## Janela de sobreposição

A janela é obrigatoriamente limitada de **5 minutos a 24 horas**. A UI oferece 15 minutos, 1 hora, 4 horas e 24 horas.

Uma janela curta permite trocar a credencial sem derrubar imediatamente um dispositivo rural que possa estar temporariamente offline. Ela não deve ser tratada como período de graça permanente.

## Regras de segurança

- apenas quem passa por `app_can_manage_device()` pode rotacionar;
- uma predecessora deve estar ativa e não expirada;
- uma mesma predecessora só pode originar uma sucessora;
- limite existente de até 5 chaves ativas por dispositivo continua valendo;
- nova chave expira no máximo em 365 dias;
- revogação manual continua imediata;
- tentativa de revogar chave já inativa falha em vez de gerar auditoria enganosa;
- `anonymous` não recebe EXECUTE da RPC;
- nenhum DML direto da tabela é introduzido para o browser.

## Auditoria

A ação `device.ingest_key.rotation_started` registra:

- `predecessor_key_id`;
- `new_key_id`;
- fim da janela da predecessora;
- expiração da nova chave;
- duração da sobreposição;
- `raw_key_stored=false`.

O log não contém chave bruta nem `key_hash`.

## Critérios de aceite

1. rotação aceita somente chave predecessora ativa e pertencente ao dispositivo;
2. Owner/Admin autorizado não consegue rotacionar dispositivo fora do seu escopo;
3. janela menor que 5 min ou maior que 24 h é recusada;
4. segunda rotação a partir da mesma predecessora é recusada;
5. predecessora recebe `expires_at` limitado à janela;
6. nova chave funciona durante a sobreposição e a antiga deixa de funcionar após seu novo `expires_at`;
7. listagem mostra `retiring` enquanto a predecessora está em sobreposição e `expired` depois;
8. hash e chave bruta não aparecem na listagem/auditoria;
9. DEV é validado antes de STAGE;
10. PROD não é alterado.
