# Evidence Vault — SEC-051/052

## Princípios
- O browser nunca recebe `storage_key` nem URL física do arquivo.
- Arquivos devem residir em storage privado; nesta fase o storage permanece `pending`.
- Evidência exige SHA-256 e manifesto; a verificação nunca altera o hash original.
- `mismatch` bloqueia exportação.
- Retenção só pode ser estendida; redução exige fluxo jurídico/administrativo futuro.
- Legal hold só pode ser habilitado/removido por Admin iFarm/Admin Organização e exige justificativa.
- Download e compartilhamento são solicitações auditadas. Enquanto não houver storage privado, ficam `blocked_storage`.
- Community e Private usam o escopo original do incidente/evento/gravação e não podem ser misturados.

## Cadeia de custódia
Cada ação recebe `previous_action_hash` e `action_hash` SHA-256. A sequência registra cadastro, verificação, retenção, legal hold e solicitações de exportação.

## Gravações
`recordings` também usa SHA-256, retenção e catálogo sanitizado. A chave física não é exposta ao portal. Uma gravação pode ser promovida a evidência por manifesto.

## Storage futuro
Recomendado: bucket privado exclusivo iFarm Security, criptografia, URLs assinadas de curta duração geradas exclusivamente pelo backend, logs de acesso e lifecycle conforme política contratual/LGPD. Não reutilizar bucket de outro projeto.
