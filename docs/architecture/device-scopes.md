# Áreas e Dispositivos — SEC-013 / SEC-020

## Áreas
Áreas pertencem exclusivamente a uma propriedade privada. Podem receber um `MultiPolygon` PostGIS em WGS84 (EPSG:4326). A criação aceita GeoJSON opcional e rejeita geometrias que não sejam Polygon/MultiPolygon ou que sejam inválidas.

## Escopo de dispositivos
### Community
- exige `neighborhood_id`;
- não aceita `property_id` ou `area_id`;
- `community_shared=true`;
- pode ser gerenciado por Admin iFarm, Admin da organização ou Admin/Técnico explicitamente vinculado ao bairro.

### Private
- exige `property_id`;
- `area_id` é opcional, mas quando presente precisa pertencer à mesma propriedade;
- `community_shared=false`;
- pode ser gerenciado por Admin iFarm, Admin da organização, Proprietário ou Técnico explicitamente vinculado à propriedade.

O vínculo da propriedade com um bairro não concede ao administrador comunitário acesso ao dispositivo privado.

## Localização
Dispositivos aceitam latitude/longitude como par e armazenam `geography(Point,4326)`. Latitude: -90..90; longitude: -180..180.

## Tipos iniciais
`camera`, `sensor`, `gateway`, `nvr`, `gps`, `siren`, `panic`.

Todo novo dispositivo começa `offline` até a primeira telemetria.
