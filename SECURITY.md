# Security Policy

Este repositório não deve conter credenciais, tokens, chaves privadas, dados pessoais reais, imagens de vigilância reais ou qualquer informação operacional sensível.

## Regras mínimas

- Secrets apenas em cofres/variáveis de ambiente do provedor.
- Separação de ambientes DEV, STAGE e PROD.
- Mudanças em produção somente após validação em DEV e STAGE.
- MFA para acessos administrativos.
- Princípio do menor privilégio.
- Logs e trilha de auditoria para operações sensíveis.
- Nenhuma integração governamental ou biométrica sem autorização formal, base legal, contrato/convênio e revisão jurídica.

## Incidentes

Qualquer suspeita de exposição de credenciais ou dados deve resultar em rotação imediata das credenciais afetadas e investigação registrada.
