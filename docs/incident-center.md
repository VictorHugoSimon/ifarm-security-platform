# Incident Center — SEC-050

## Objetivo
Organizar resposta operacional a eventos relevantes sem presumir crime, autoria ou prova definitiva.

## Entrada
Um incidente só nasce por ação humana a partir de evento que esteja:
- `confirmed` por validação humana; ou
- `not_required` para eventos técnicos/operacionais.

Eventos `pending` e `rejected` são bloqueados.

## Escopo
O incidente herda organização, bairro/propriedade e severidade do evento de origem.
Eventos adicionais precisam ter exatamente o mesmo escopo:
- incidente privado → somente eventos da mesma propriedade;
- incidente comunitário → somente eventos comunitários do mesmo bairro;
- nunca misturar propriedades diferentes.

## Ciclo
`open → investigating → monitoring → resolved → closed`

No MVP, `closed` é terminal e não pode ser reaberto por RPC.

## Responsabilidade e timeline
- criador assume inicialmente o incidente;
- usuário autorizado pode usar “Assumir”;
- mudanças de status, notas, vínculo de evento e responsabilidade geram `incident_actions`;
- ações ficam protegidas pelo mesmo RLS do incidente.

## O que ainda não está aqui
Evidence Vault, gravações, download/compartilhamento, retenção e integridade serão tratados na próxima evolução. iFarm SOS terá jornada própria e não presumirá integração pública.
