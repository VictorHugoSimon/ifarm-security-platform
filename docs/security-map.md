# Security Map — SEC-030

## Objetivo
Exibir somente entidades autorizadas ao usuário autenticado: propriedades, áreas privadas, dispositivos Community/Private e incidentes georreferenciáveis.

## Segurança de acesso
- `get_security_map()` usa `SECURITY INVOKER`.
- As tabelas continuam protegidas pelo RLS multi-tenant.
- Sem sessão autenticada, o teste no DEV retornou 0 features.
- Admin de bairro não recebe acesso implícito aos pontos privados de propriedades.
- Atualização de localização da propriedade exige `app_can_manage_property()` e grava `audit_logs`.

## Geoespacial
- PostgreSQL + PostGIS, SRID 4326.
- Propriedade: `centroid` e `boundary`.
- Área: `boundary` MultiPolygon.
- Dispositivo: `location` Geography(Point,4326).
- Incidente herda ponto da propriedade ou centróide do limite do bairro quando disponível.

## Tiles e privacidade
No DEV o frontend usa tiles públicos do OpenStreetMap apenas como base visual. Marcadores e dados privados não são enviados ao provedor de tiles, porém a requisição de tiles revela ao provedor o viewport aproximado do navegador.

Por isso, antes de STAGE com dados reais e antes do piloto/PROD, escolher uma destas opções:
1. provedor cartográfico contratado com avaliação de privacidade e contrato adequado;
2. infraestrutura de tiles própria/self-hosted;
3. camada cartográfica corporativa com política formal de retenção e acesso.

O código desativa a base cartográfica pública automaticamente fora de `import.meta.env.DEV`.

## Próximas evoluções
- editor de perímetro da propriedade;
- desenho de áreas privadas;
- vias/acessos comunitários;
- clusters de dispositivos;
- incidentes em tempo real;
- status de gateway/conectividade;
- caminho até a propriedade usando exclusivamente pontos comunitários autorizados.
