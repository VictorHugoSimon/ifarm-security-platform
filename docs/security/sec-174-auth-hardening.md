# SEC-174 — Verified-account gate e hardening Neon Auth

Data de referência: 2026-09-10.

## Objetivo
Impedir que uma sessão autenticada, porém sem e-mail verificado, carregue qualquer módulo, tenant ou dado operacional do iFarm Security. A medida complementa o convite + RLS e não substitui o hardening do provider Neon Auth.

## Estado live auditado
DEV e STAGE usam Neon Auth `better_auth` isolado por branch.

Na auditoria de 2026-09-10, ambos ainda apresentavam:
- email/password habilitado;
- `allow_sign_up=true`;
- `require_email_verification=false`;
- verificação no signup/signin desabilitada;
- `allow_localhost=true`.

O conector Neon disponível nesta execução não expõe mutação oficial para esses parâmetros. Não editar `neon_auth.project_config` diretamente nem usar SQL em configuração interna do provider como workaround.

## Redução de superfície já executada
- OAuth Google compartilhado removido de DEV;
- OAuth Google compartilhado removido de STAGE;
- nenhuma origem remota permanece em trusted origins do STAGE enquanto o Cloudflare Pages ainda não existir;
- Data API CORS do STAGE permanece em localhost até o Pages ser criado e sua URL real ser comprovada;
- PROD não foi alterado.

Uma tentativa inicial de pré-cadastrar o hostname reservado do Pages foi revertida antes de uso porque a propriedade do hostname ainda não estava comprovada. A origem remota só poderá ser liberada depois que o workflow Cloudflare criar o recurso exclusivo e retornar a URL real.

## Gate da aplicação
`AuthGate.tsx` agora exige `session.data.user.emailVerified === true` antes de renderizar os filhos protegidos. Se a conta estiver autenticada e `emailVerified` não for exatamente `true`:
- o shell não é renderizado;
- nenhum módulo/tenant é carregado;
- o usuário recebe tela de bloqueio;
- existe apenas saída segura da sessão.

A função `claim_my_invited_access()` no banco já exige e-mail verificado e convite válido, então SEC-174 cria defesa em profundidade antes mesmo da tentativa de ativação.

## Gate obrigatório antes de uso real
Ainda é obrigatório, no Neon Auth STAGE, por caminho oficial suportado:
1. fechar signup público;
2. exigir verificação de e-mail no provider;
3. desligar localhost para STAGE quando a URL oficial existir;
4. cadastrar somente a URL real do Pages como trusted origin;
5. atualizar Data API CORS para a mesma origem;
6. definir e validar MFA para os perfis exigidos;
7. executar smoke autenticado com identidade QA controlada.

Até esses itens serem concluídos, STAGE não está aprovado para cliente, piloto ou usuário real.
