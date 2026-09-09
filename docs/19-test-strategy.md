# SEC-120 — Estratégia de Testes

## Pirâmide inicial
1. Testes rápidos sem infraestrutura: validação HTTP, segurança e invariantes públicas.
2. Testes de banco no DEV: RLS, RBAC, Community/Private e RPCs negativas.
3. Testes integrados no STAGE: Auth → portal → API → PostgreSQL → storage/queues quando existirem.
4. Smoke do piloto: dispositivos reais, perda de internet, buffer/retry, alertas, SOS e evidências.

## Cobertura automatizada atual
A API usa o `node:test` nativo do Node 24, sem framework adicional e sem banco real na CI. Casos iniciais:
- `/health` funciona sem banco;
- `x-request-id` válido é propagado e valor inseguro é substituído;
- `/ready` falha fechado com 503 sem banco;
- status mantém storage, monitoramento humano, despacho público, governo e biometria desabilitados;
- heartbeat rejeita UUID inválido;
- heartbeat rejeita payload acima de 32 KiB;
- heartbeat rejeita credencial ausente;
- GPS de ativo rejeita coordenadas inválidas.

## Testes obrigatórios antes de STAGE
- tenant A não lê tenant B;
- Admin bairro não lê dispositivo privado;
- família/funcionário não alteram adesão Community;
- apenas proprietário consente dados Security para Insurance;
- evidence/recordings não expõem `storage_key` no portal;
- IA pending/rejected não vira incidente;
- SOS não chama integração pública;
- ingestão Device não aceita chave inválida;
- posição GPS fora de ordem não sobrescreve atual;
- exportação Evidence permanece bloqueada sem storage.

## Testes de conectividade do piloto
Executar cenários de 4G/radio/fibra/satélite conforme local: 5, 15, 30 e 60 minutos offline; buffer local; reenvio; deduplicação; ordem temporal; recuperação; consumo de banda; perda de frame; uptime e latência.

## Regra de promoção
Nenhuma promoção para STAGE/PROD com `security:check`, testes, typecheck ou build falhando.
