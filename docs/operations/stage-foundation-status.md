# SEC-140 — STAGE Foundation Status

Data de referência: 2026-09-09. Atualizado após SEC-150/SEC-160.

## Estado
- STAGE usa branch Neon exclusiva do iFarm Security.
- Neon Auth Better Auth foi provisionado exclusivamente no STAGE.
- Data API foi provisionada exclusivamente no STAGE com schema `public`, limite de 1000 linhas, claim `.role` e OpenAPI desabilitado.
- Nenhum usuário real, dispositivo real, evidência real ou dado de cliente foi criado no STAGE durante a fundação.
- Migrations 0001–0016 foram promovidas ao STAGE em ordem.
- Migration 0017 adiciona hardening comum a DEV/STAGE.
- SEC-150 executou matriz RBAC completa com usuários e dados exclusivamente sintéticos `QA-SEC150`.
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
- CI executa gates de secrets, migrations e invariantes RBAC.

## Auth/CORS — estado DEV-only
- Frontend não oferece signup público.
- Auth provider do STAGE ainda permite signup e ainda não exige verificação de e-mail: bloqueador para uso real.
- MFA ainda não foi comprovado no provider: bloqueador para uso real.
- Auth `trusted_origins` está vazio e localhost permanece permitido.
- Data API CORS está limitado a `http://localhost:5173`.
- DEV e STAGE usam endpoints públicos Neon distintos; nenhum secret é necessário no browser.

## Pendências antes de uso real do STAGE
- Definir origem frontend STAGE e substituir/ajustar CORS localhost.
- Configurar signup fechado, verificação de e-mail e MFA por caminho oficial suportado do Neon Auth.
- Criar identidade QA com credencial controlada e executar smoke end-to-end do frontend/API.
- Conectar storage privado somente quando aprovado; nunca versionar credenciais.
- Manter PROD bloqueado até gate separado.
