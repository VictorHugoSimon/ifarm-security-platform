# Piloto — Readiness Checklist

Escopo esperado: 1 bairro + 5 a 10 propriedades + pontos comunitários e privados.

## Produto já modelado
- multi-tenant, Auth, RBAC/RLS;
- organização, bairro, propriedade, área e dispositivos;
- Security Map;
- telemetria e online/offline;
- eventos, alertas, validação humana e incidentes;
- Evidence Vault (manifesto; storage físico pendente);
- iFarm SOS interno;
- Asset Security;
- Insurance básico com consentimento;
- Community;
- Operations/SOC interno;
- health/readiness e logs estruturados.

## Bloqueadores antes de piloto conectado
1. GitHub deve ser Private.
2. Criar Cloudflare Pages/Worker/R2/Queues exclusivos do iFarm Security.
3. Configurar secrets exclusivos fora do código.
4. Definir storage privado de vídeo/evidências, criptografia e retenção.
5. Promover migrations DEV → STAGE; executar testes; só depois PROD.
6. Definir domínio/subdomínio e TLS.
7. Selecionar câmeras/NVR/gateway homologados e protocolos.
8. Validar conectividade do bairro e redundância.
9. Formalizar termos de participação, uso de imagem, LGPD, retenção e responsabilidades com advogado/DPO.
10. Definir operação de suporte/manutenção e SLA comercial real.
11. Definir parceiro de Insurance e modelo permitido antes de venda/intermediação.
12. Não ativar biometria/governo no piloto MVP.

## Métricas do piloto
Uptime; perda de conectividade; tempo de instalação; latência de alerta; eventos por dispositivo; falsos positivos; tempo de reconhecimento; incidentes; saúde de câmera; consumo de dados; custo mensal; satisfação; adesão Community; churn/intenção de continuidade; MRR potencial; tickets de manutenção.
