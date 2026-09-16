# SEC-197 — Idempotency Contract at API Edge

## Objetivo

Aplicar no Worker o mesmo contrato de `eventId` já exigido pelo banco nas SEC-194/195, rejeitando eventos sem identidade idempotente antes de qualquer SQL.

## Contrato

- heartbeat e Asset Security/GPS exigem `eventId`;
- formato permitido: `^[A-Za-z0-9._:-]{1,128}$`;
- ausência, string vazia, excesso de 128 caracteres, espaços, barras e outros caracteres fora do padrão retornam `400 invalid_event_id`;
- o Worker não gera `eventId` automaticamente, porque isso destruiria a idempotência entre buffer rural, retransmissões e cloud;
- não há janela mínima/máxima de idade do identificador: sincronização offline continua possível;
- o banco continua sendo a segunda barreira e permanece autoritativo;
- nenhum payload rejeitado por `eventId` inválido chega às RPCs de ingestão;
- PROD permanece fora desta etapa.

## Critérios de aceite

- helper `isValidEventId` usa exatamente o padrão do banco;
- ambas as rotas exigem `eventId` antes do SQL;
- SQL recebe somente o `eventId` já validado;
- testes cobrem ausente, 128 caracteres, 129 caracteres, espaços e `/`;
- CI, Pages STAGE e API STAGE exigem `pnpm api-idempotency:check`.
