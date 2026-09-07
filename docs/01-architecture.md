# Arquitetura v0.1

## Hierarquia multi-tenant
iFarm Security → Organização → Bairro → Propriedade → Área → Equipamento.

## Camadas
1. Dispositivos: câmeras, sensores, GPS, sirenes.
2. Edge: NVR/gateway/buffer local.
3. Conectividade: fibra, rádio, 4G/5G, satélite.
4. API: edge/serverless, API-first.
5. Core: identidade, mapa, dispositivos, eventos, alertas, incidentes, evidências, ativos.
6. Dados: PostgreSQL/PostGIS + object storage separado para vídeo/evidências.
7. Canais: Web/PWA/App/SOC/APIs.

## Ambientes
DEV → STAGE → PROD. Sem migração direta em PROD.

## Decisões iniciais
- TypeScript como linguagem principal.
- React/Vite para portal/PWA.
- Hono/Cloudflare Workers para API inicial.
- Neon PostgreSQL 18 + PostGIS.
- São Paulo como região do banco para baixa latência no Brasil.
