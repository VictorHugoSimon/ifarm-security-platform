# SEC-140 — STAGE Foundation Status

Data de referência: 2026-09-09.

## Estado
- STAGE usa branch Neon exclusiva do iFarm Security.
- Neon Auth Better Auth foi provisionado exclusivamente no STAGE.
- Data API foi provisionada exclusivamente no STAGE com schema `public`, limite de 1000 linhas, claim `.role` e OpenAPI desabilitado.
- Nenhum usuário real, dispositivo real, evidência real ou dado de cliente foi criado no STAGE durante a fundação.
- Migrations 0001–0016 foram promovidas ao STAGE em ordem.
- Migration 0017 adiciona hardening comum a DEV/STAGE.
- PROD permanece intocado.

## Repositório público
Por decisão do projeto, o repositório pode permanecer público durante desenvolvimento. Enquanto público, continuam proibidos no Git: secrets, tokens, connection strings privilegiadas, chaves de dispositivos, credenciais de storage, evidências privadas, vídeos/câmeras reais e dados reais de clientes.

## Segurança preservada
- Community não permite compartilhamento de dispositivos privados.
- Ingestão de heartbeat/GPS permanece inacessível ao role normal `authenticated`.
- Evidence Vault não expõe `storage_key` pelos catálogos sanitizados.
- Insurance usa dados do Security somente por consentimento explícito do proprietário.
- iFarm SOS não presume despacho público.
- Operations/SOC mantém `human_monitoring_assumed=false` e `public_dispatch_enabled=false`.
- Integrações governamentais e biometria permanecem fora desta fase.

## Pendências antes de uso real do STAGE
- Definir origem frontend STAGE e substituir CORS localhost.
- Configurar política de e-mail/verificação/MFA apropriada para STAGE.
- Criar usuários de teste sintéticos e executar matriz RBAC completa.
- Conectar storage privado somente quando aprovado; nunca versionar credenciais.
- Validar smoke tests end-to-end do frontend/API em endpoint STAGE.
- Manter PROD bloqueado até gate separado.
