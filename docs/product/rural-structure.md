# Estrutura Rural — SEC-010/011/012

## Hierarquia inicial
`iFarm Security → Organização → Bairro Rural → Propriedade → Área → Equipamento`.

## Regras implementadas
- Organização só pode ser criada por usuário global `admin_ifarm` com e-mail verificado.
- Criação de organização inicializa o vínculo administrativo e registra auditoria.
- Bairro rural só pode ser criado por Admin iFarm ou Admin da organização.
- Propriedade só pode ser criada por Admin iFarm ou Admin da organização.
- Um bairro informado para uma propriedade precisa pertencer à mesma organização.
- UF aceita somente duas letras.
- Todas as três operações usam funções transacionais `SECURITY DEFINER` com autorização interna e auditoria.
- As tabelas continuam protegidas por RLS para leitura.
- Não existem políticas genéricas de escrita direta nas tabelas via Data API.

## Community x Private
O bairro é o escopo comunitário. A propriedade é o escopo privado. O fato de uma propriedade pertencer a um bairro não concede ao administrador do bairro acesso automático aos dispositivos, gravações, evidências ou ativos privados daquela propriedade.

## Próximo passo
Adicionar áreas, dispositivos e mapa georreferenciado, mantendo autorização por escopo e trilha de auditoria.
