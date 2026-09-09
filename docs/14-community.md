# SEC-090 — Community / Bairro Rural Conectado

## Princípio
Participação no bairro é opt-in da propriedade. Ela não concede ao Admin do bairro acesso a câmeras, gravações, eventos ou ativos privados.

## Escopo do MVP
- adesão e saída controladas pelo proprietário;
- preferências para rota comunitária e alertas comunitários;
- câmeras comunitárias (`community_shared=true`, `property_id IS NULL`);
- caminho até a propriedade composto somente por câmeras comunitárias selecionadas pelo proprietário;
- dashboard do bairro com saúde dos pontos comunitários;
- manutenção comunitária;
- lista de propriedades participantes apenas para perfil administrativo do bairro;
- regras do bairro com `private_device_sharing_allowed=false` como invariável de banco.

## Caminho até minha propriedade
A rota não compartilha câmeras privadas. Cada propriedade ativa no Community pode selecionar e ordenar câmeras comunitárias do mesmo bairro. O ponto final é o centróide cadastrado da propriedade, quando disponível.

## Permissões
- Proprietário: ativa/sai do Community, configura preferências e seus pontos de rota.
- Família/Funcionário com acesso à propriedade: pode visualizar os pontos comunitários autorizados da propriedade, mas não altera a adesão.
- Admin do bairro/organização: regras comunitárias, visão administrativa de participantes e operação dos dispositivos comunitários.
- Técnico do bairro: manutenção comunitária; não recebe acesso privado da fazenda.

## Segurança
Tabelas Community não têm SELECT direto para `authenticated`; o portal usa RPCs sanitizadas. Todas as mutações relevantes geram `audit_logs`.

## Fora do escopo
- compartilhamento de câmera privada;
- biometria/governo;
- despacho automático de autoridade;
- criação automática de rota viária externa;
- monitoramento humano presumido.
