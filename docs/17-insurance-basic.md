# Security + Insurance — SEC-080

## Posicionamento
O módulo acompanha jornadas de seguro por seguradoras/corretores/parceiros habilitados. A iFarm Security não é apresentada como seguradora ou corretora sem autorização regulatória aplicável.

## MVP
- pedido de cotação;
- registro de apólice externa/parceira;
- vencimento e renovação;
- registro/acompanhamento de sinistro;
- documentos como metadados (`storage_status=not_configured`);
- consentimento explícito para eventual uso de dados do Security.

## Dados do Security
Cotação nasce com `security_data_use=false`. Apenas proprietário pode conceder consentimento. Habilitação exige consentimento ativo, finalidade `quote_support`, mesmo escopo de propriedade/ativo e não expirado. Revogação desabilita o uso em cotações ainda não finalizadas.

## Acesso
MVP: Admin iFarm, Admin Organização e Proprietário. O perfil `insurance_partner` não recebe acesso direto nesta fase; onboarding de parceiro exige contrato, finalidade, minimização de dados e autorização.

## Sinistros
Status no sistema é acompanhamento do processo externo. `approved`, `denied` ou `paid` representam informação recebida/registrada do parceiro e não decisão da iFarm.
