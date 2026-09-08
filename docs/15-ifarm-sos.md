# iFarm SOS — SEC-060

## Objetivo
Registrar um pedido de assistência interno com propriedade, localização, solicitante, ocorrência, incidente e evidências autorizadas.

## Fluxo
Usuário autenticado → propriedade autorizada → GPS atual ou centróide cadastrado → `sos_requests` → incidente crítico interno → reconhecimento humano → atendimento/encerramento.

## Regras
- Não chama polícia, bombeiros, prefeitura ou qualquer órgão automaticamente.
- `public_integration_status` nasce `not_configured`.
- Não presume crime, autoria, flagrante ou prova definitiva.
- Família/funcionário com acesso à propriedade pode iniciar SOS.
- Reconhecimento/gestão usa perfis administrativos, proprietário ou monitoramento conforme escopo.
- Contato primário é o próprio usuário autenticado; não armazenamos telefone em claro nesta fase.
- Evidências só podem ser vinculadas se pertencem à mesma propriedade/escopo.
