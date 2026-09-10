# SEC-172 — Browser privilege hardening

Data de referência: 2026-09-10.

## Origem
Auditoria somente leitura do STAGE encontrou dois gaps de defesa em profundidade:
- `authenticated` possuía grants diretos de INSERT/UPDATE/DELETE em 14 tabelas-base do schema `public`; o RLS reduzia o impacto, mas o desenho do produto exige escrita por RPC controlada;
- 68 funções próprias do iFarm Security ainda eram executáveis por `anonymous` por herança do default PostgreSQL `EXECUTE TO PUBLIC`.

Nenhuma tabela de aplicação sem RLS foi encontrada e não houve evidência de vazamento lateral no teste SEC-150.

## Correção
Migration `0018_privilege_hardening.sql`:
1. converte cinco RPCs de escrita legítimas que eram `SECURITY INVOKER` para `SECURITY DEFINER`, mantendo os checks internos de gestão/escopo já existentes;
2. revoga DML direto de `authenticated` e `anonymous` em todas as tabelas do schema `public`;
3. para funções próprias não pertencentes a extensões, captura a permissão efetiva autenticada anterior, revoga EXECUTE de `PUBLIC`/`anonymous` e restaura EXECUTE somente a `authenticated` quando já existia antes;
4. não altera funções pertencentes às extensões PostGIS/pgcrypto;
5. endurece default privileges para que novas funções não nasçam executáveis por PUBLIC e novas tabelas não concedam DML direto aos roles do browser.

## RPCs convertidas
- `register_device_ingest_key`
- `revoke_device_ingest_key`
- `set_property_location`
- `set_property_boundary`
- `set_area_boundary`

Essas RPCs continuam autorizando a operação pelo mesmo RBAC interno; a mudança apenas elimina a dependência de DML direto do role do browser.

## Evidência de validação
A migration foi aplicada primeiro no DEV e depois no STAGE, sem tocar PROD.

Resultado pós-migration em DEV e STAGE:
- funções próprias executáveis por `anonymous`: **0**;
- grants DML diretos (`INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`) para `anonymous`/`authenticated`: **0**;
- cinco RPCs controladas acima confirmadas como `SECURITY DEFINER`: **5/5**;
- funções próprias ainda executáveis por `authenticated`: **96**, preservando a superfície autenticada efetiva anterior;
- todas as tabelas de aplicação no schema `public` permanecem com RLS habilitado.

A matriz sintética SEC-150 foi reexecutada no STAGE depois do hardening e permaneceu idêntica:
- Admin Organização: comunidade + privadas A/B; gestão A/B;
- Admin Bairro: somente comunidade; sem gestão privada;
- Proprietário A: comunidade + privada A; sem acesso à privada B;
- Família A: comunidade + privada A; sem gestão privada e sem acesso à B;
- Técnico de Bairro: somente comunidade; sem acesso privado;
- Monitoramento A: comunidade + privada A; sem acesso à privada B.

Não foi observado vazamento lateral entre Fazenda A e Fazenda B após a SEC-172.

Uma tentativa adicional de write-smoke transacional com rollback foi bloqueada pela camada de segurança da ferramenta antes da execução; nenhum dado foi alterado por essa tentativa. A validação da migration foi concluída por catálogo de privilégios, propriedades das funções e replay completo da matriz RLS.

## Gate de deploy
O workflow Cloudflare STAGE passa também a exigir que o repositório GitHub esteja `private` antes de ler credenciais ou fazer qualquer chamada Cloudflare. Como o conector atual não oferece mutação de visibilidade, essa condição fica bloqueante até a alteração da visibilidade na conta GitHub.

## Promoção
DEV e STAGE validados. PROD permanece intocado até gate separado.
