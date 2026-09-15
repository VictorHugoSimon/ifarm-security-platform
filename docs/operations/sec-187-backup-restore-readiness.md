# SEC-187 — Backup & Restore Readiness

Data de referência: 2026-09-15.

## Objetivo
Definir uma postura realista de backup/restore para o iFarm Security antes de qualquer uso real em produção. Esta frente não transforma limitações do plano atual em promessa de resiliência.

## Estado observado no Neon
Projeto dedicado: `restless-cell-49791922`.

Observações live em 2026-09-15:
- assinatura: `free_v3`;
- 6 horas de history retention;
- DEV: nenhum schedule automático de snapshot;
- STAGE: nenhum schedule automático de snapshot;
- PROD: nenhum schedule automático de snapshot;
- tentativa de snapshot manual em branch não-root foi recusada pelo provider;
- tentativa de configurar schedule automático no DEV foi recusada porque backup schedule não está habilitado para este projeto.

Portanto, não existe schedule automático de snapshot habilitado e **PROD não está liberado para dados reais**.

## Estado de PROD
A branch PROD continua fora das migrations de aplicação e sem tabelas do produto. Nenhuma configuração de backup foi alterada em PROD durante a SEC-187.

## Metas provisórias do piloto
Para planejamento operacional do piloto, adotar como referência inicial:
- RPO 24h;
- RTO 8h;
- classificação: meta operacional provisória e não contratual.

Esses valores não são SLA comercial. Devem ser revisados após restore drill real, volume de vídeo/evidências, armazenamento escolhido, conectividade rural e custos.

## Gate obrigatório antes de dados reais em PROD
Todos os itens abaixo precisam estar comprovados:
1. `backup_schedule_enabled` — política automática compatível com retenção aprovada;
2. `restore_drill_passed` — restauração completa testada em branch isolada;
3. `rpo_rto_approved` — metas aprovadas por Produto/Operações e refletidas contratualmente quando aplicável;
4. `auth_provider_hardened` — hardening live da SEC-184 concluído;
5. `repository_private` — repositório privado conforme gate já existente.

Enquanto qualquer requisito estiver pendente, `realUsersAllowed=false`.

## Procedimento futuro de restore drill
Quando snapshots estiverem disponíveis:
1. gerar/selecionar snapshot da branch de origem;
2. restaurar primeiro em **nova branch isolada**, nunca diretamente sobre PROD;
3. não apagar ou sobrescrever PROD como primeiro passo de restore;
4. validar existência e quantidade de tabelas, migrations e extensões;
5. validar RLS, privilégios de `anonymous/authenticated`, Auth e Data API;
6. executar smoke de tenant A/B, dispositivos, eventos, incidentes, Evidence Vault, suporte, privacidade e piloto;
7. medir tempo total de restauração para calcular RTO observado;
8. comparar ponto recuperado com a última gravação conhecida para calcular RPO observado;
9. registrar evidência, responsável, data, snapshot/branch e resultado;
10. somente então definir procedimento de promoção/swap para recuperação real.

## Evidências e vídeo
Backup do banco não equivale a backup de evidências, gravações ou objetos privados. O provider de object storage/retention ainda precisa de política própria, versionamento/imutabilidade quando aplicável e restore drill separado.

## Responsabilidades
- Produto: aprovar objetivos de disponibilidade/retenção e impacto comercial;
- Tecnologia/DevOps: configurar backups e executar drills;
- Segurança/LGPD: validar retenção, legal hold, minimização e acesso aos backups;
- Jurídico/DPO: validar prazos obrigatórios quando houver dados pessoais/evidências;
- Operações: manter runbook e registrar cada drill/incidente.

## Proibições
- não declarar backup garantido enquanto a capacidade não estiver ativa e testada;
- não prometer zero perda de dados;
- não restaurar diretamente sobre PROD como primeira tentativa;
- não misturar snapshots/branches com outros projetos;
- não considerar history retention de 6h como política suficiente de produção.

## Próxima validação
Reauditar esta política quando ocorrer qualquer um destes eventos:
- mudança de plano Neon;
- backup schedule passar a estar disponível;
- criação do primeiro ambiente PROD real;
- adoção de storage de evidências/gravações;
- primeiro restore drill.
