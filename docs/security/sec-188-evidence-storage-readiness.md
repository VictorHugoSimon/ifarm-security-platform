# SEC-188 — Evidence/Object Storage Readiness

Data de referência: 2026-09-15.

## Estado atual
- Evidence Vault já registra `storage_key` opaco, SHA-256, retenção, legal hold e trilha de ações.
- A API continua declarando `storageConfigured=false`.
- Neon branchable object storage não está disponível na região atual do projeto em DEV, STAGE ou PROD.
- Nenhum bucket de evidências foi provisionado.
- Cloudflare R2 permanece candidato de arquitetura, não recurso existente.

## Regras obrigatórias
1. Bucket sempre privado; nunca `public_read`.
2. Credenciais de storage apenas server-side; nunca em Vite/browser.
3. Upload/download apenas por fluxo autenticado e URL assinada curta; máximo previsto: 900 segundos.
4. `storage_key` continua opaco e sem URL completa.
5. Chaves devem isolar tenant/organização e evitar enumeração previsível.
6. Download exige solicitação/exportação aprovada no Evidence Vault.
7. Legal hold impede deleção física.
8. Retenção deve ser verificada antes de qualquer deleção.
9. `deleteEnabled=false` até existir workflow de deleção auditado e testado.
10. Backup/restore de objetos é separado do backup do PostgreSQL.

## Gate de produção
Enquanto `objectStorage.configured=false`, uploads e downloads reais de evidências permanecem bloqueados. Antes de liberar:
- bucket privado provisionado exclusivamente para iFarm Security;
- credenciais dedicadas server-side;
- fluxo de URL assinada testado;
- isolamento entre tenants testado;
- retenção + legal hold comprovados end-to-end;
- política de backup/restore do storage definida e testada.

## Candidato Cloudflare R2
Nome reservado para STAGE: `ifarm-security-evidence-stage`.
Nome reservado para PROD: `ifarm-security-evidence-prod`.

Esses nomes são contrato de arquitetura, não confirmação de que os buckets existem.

## Proibições
- não reutilizar bucket de iFarm, Instituto Államo, Ser Vital, Maison Decants, Terra Pulse ou qualquer outro projeto;
- não armazenar segredo de R2 no frontend;
- não expor listagem pública;
- não entregar `storage_key` bruto como URL pública;
- não permitir deleção quando `legal_hold=true`;
- não marcar exportação como `fulfilled` antes de o objeto realmente ser entregue por fluxo controlado.

## Próximo passo operacional
Quando o repositório estiver privado e houver credenciais Cloudflare exclusivas, provisionar primeiro o bucket STAGE, validar CORS/origem exata, presigned URL, upload/download de fixture sintético, integridade SHA-256, legal hold e isolamento A/B. PROD permanece fora até gate separado.
