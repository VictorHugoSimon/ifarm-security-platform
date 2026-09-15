# SEC-192 — Device Credential Lifecycle / Key Rotation

## Objetivo

Consolidar o ciclo de vida e a rotação controlada das credenciais usadas por câmeras, gateways e dispositivos para enviar telemetria ao Worker do iFarm Security, sem armazenar segredo recuperável na plataforma.

Esta SEC incorpora o hardening que havia sido preparado separadamente no PR #45, eliminando a divergência entre código e os ambientes DEV/STAGE onde esse hardening já havia sido validado.

## Princípios

- a chave bruta nunca é enviada ao banco;
- o navegador gera 256 bits aleatórios, monta o token `ifs_...` e envia somente SHA-256;
- o valor bruto é exibido uma única vez e não é salvo em `localStorage` ou `sessionStorage`;
- o banco nunca retorna hash ou chave bruta nas RPCs de listagem/rotação;
- logs de auditoria registram IDs e datas, nunca o segredo nem seu hash;
- toda credencial possui expiração obrigatória;
- novas credenciais usam **90 dias** por padrão e nunca podem exceder 365 dias;
- no máximo 5 chaves ativas e não expiradas podem coexistir por dispositivo;
- a rotação não substitui um processo operacional de atualização do gateway/dispositivo.

## Registro de nova credencial

`register_device_ingest_key()` é `SECURITY DEFINER`, mas antes de gravar qualquer hash exige `app_can_manage_device()` para o dispositivo exato. A tabela `device_ingest_keys` continua sem SELECT/DML direto para o browser.

Regras:
- hash deve ser SHA-256 hexadecimal com 64 caracteres;
- label possui no máximo 80 caracteres;
- `expires_at` é obrigatório na tabela;
- quando o frontend não informa expiração, a RPC usa 90 dias;
- expiração maior que 365 dias é recusada;
- limite de 5 chaves ativas/não expiradas permanece fail-closed;
- auditoria grava `raw_key_stored=false`.

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

## Listagem sanitizada

`list_device_ingest_keys()` não pode depender de SELECT direto do role `authenticated`, porque a tabela de credenciais é deliberadamente isolada do browser. A RPC usa `SECURITY DEFINER`, valida `app_can_manage_device()` primeiro e retorna somente:
- ID da credencial;
- label;
- status efetivo;
- expiração;
- último uso;
- criação;
- revogação.

Nunca retorna `key_hash` ou chave bruta. O status efetivo pode ser `active`, `retiring`, `expired` ou `revoked`.

## Regras de segurança

- apenas quem passa por `app_can_manage_device()` pode criar, listar, rotacionar ou revogar;
- uma predecessora deve estar ativa e não expirada;
- uma mesma predecessora só pode originar uma sucessora;
- limite de até 5 chaves ativas por dispositivo continua valendo;
- nova chave expira no máximo em 365 dias;
- revogação manual continua imediata;
- tentativa de revogar chave já revogada falha em vez de gerar auditoria enganosa;
- `anonymous` não recebe EXECUTE das RPCs;
- nenhum SELECT/DML direto da tabela é introduzido para o browser.

## Auditoria

A ação `device.ingest_key.rotation_started` registra:
- `predecessor_key_id`;
- `new_key_id`;
- fim da janela da predecessora;
- expiração da nova chave;
- duração da sobreposição;
- `raw_key_stored=false`.

O log não contém chave bruta nem `key_hash`.

## Estado live antes da promoção SEC-192

Em 2026-09-15:
- DEV: 0 chaves cadastradas;
- STAGE: 1 chave QA ativa (`QA-SEC191 default-90`) com validade de 90 dias;
- DEV/STAGE já possuíam `expires_at NOT NULL` e a versão endurecida de `register_device_ingest_key()` validada durante o trabalho anterior;
- a `main` ainda não continha essa migration consolidada;
- foi identificado um bug live: `list_device_ingest_keys()` era `SECURITY INVOKER` enquanto `authenticated` não possui SELECT na tabela, causando `permission denied for table device_ingest_keys` após passar pelo escopo.

A SEC-192 corrige esse desalinhamento e passa a ser a migration canônica do lifecycle de credenciais.

## Validação executada — 2026-09-15

### CI
- CI #73: 100% verde;
- migration inventory, RBAC, privilege hardening, Auth, API perimeter, device-key lifecycle, deploy-readiness, testes, typecheck e build passaram.

### DEV
- migration consolidada aplicada em transação;
- `expires_at NOT NULL`: confirmado;
- `rotated_from_key_id`: presente;
- índice de sucessora única: presente;
- `list_device_ingest_keys()` = `SECURITY DEFINER`;
- `authenticated` continua sem SELECT direto na tabela;
- `authenticated` possui EXECUTE em list/rotate;
- `anonymous` não possui EXECUTE em list/rotate;
- DEV permanece com 0 chaves cadastradas.

### STAGE
- mesma migration aplicada após DEV;
- estrutura/privilégios equivalentes ao DEV confirmados;
- Owner A foi reconhecido por `app_can_manage_device()` na câmera privada A;
- antes da correção, a listagem reproduziu `permission denied for table device_ingest_keys`;
- depois da correção, o mesmo Owner A listou com sucesso a chave `QA-SEC191 default-90` sem receber hash ou chave bruta;
- a tentativa de executar o smoke de rotação pela ferramenta desta sessão foi bloqueada pela camada de segurança antes de qualquer chamada ao banco, por envolver criação/rotação de credencial;
- leitura pós-bloqueio confirmou que nenhuma sucessora foi criada e a chave QA original permaneceu inalterada.

O bloqueio do smoke de rotação é limitação da ferramenta de execução desta sessão, não evidência de falha da RPC. A rotação permanece coberta pelos invariantes de CI e pelo contrato do banco, devendo receber smoke operacional pelo portal/ambiente autorizado antes do piloto real.

## Critérios de aceite

1. toda chave possui expiração e novas chaves usam 90 dias por padrão;
2. hash/label/expiração são validados no banco;
3. rotação aceita somente chave predecessora ativa e pertencente ao dispositivo;
4. Owner/Admin autorizado não consegue rotacionar dispositivo fora do seu escopo;
5. janela menor que 5 min ou maior que 24 h é recusada;
6. segunda rotação a partir da mesma predecessora é recusada;
7. predecessora recebe `expires_at` limitado à janela;
8. nova chave funciona durante a sobreposição e a antiga deixa de funcionar após seu novo `expires_at`;
9. listagem funciona sem SELECT direto e mostra `retiring`/`expired` corretamente;
10. hash e chave bruta não aparecem na listagem/auditoria;
11. DEV é validado antes de STAGE;
12. PROD não é alterado.

Critérios 3–8 relativos ao write-smoke de rotação devem ser reexecutados em ambiente operacional autorizado quando a rotação de credenciais puder ser acionada fora desta ferramenta.
