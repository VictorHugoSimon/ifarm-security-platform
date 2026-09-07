-- SEC-013 / SEC-020 — áreas privadas e cadastro de dispositivos por escopo.

CREATE OR REPLACE FUNCTION app_can_manage_neighborhood(p_neighborhood_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT app_is_platform_admin() OR EXISTS (
    SELECT 1
    FROM neighborhoods n
    JOIN memberships m ON m.organization_id = n.organization_id
    JOIN app_users u ON u.id = m.user_id
    WHERE n.id = p_neighborhood_id
      AND u.auth_user_id = NULLIF(auth.user_id(), '')::uuid
      AND u.status = 'active'
      AND m.status = 'active'
      AND (
        m.role = 'admin_organization'
        OR (m.neighborhood_id = p_neighborhood_id AND m.role IN ('admin_neighborhood','technician'))
      )
  )
$$;

CREATE OR REPLACE FUNCTION app_can_manage_property(p_property_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT app_is_platform_admin() OR EXISTS (
    SELECT 1
    FROM properties p
    JOIN memberships m ON m.organization_id = p.organization_id
    JOIN app_users u ON u.id = m.user_id
    WHERE p.id = p_property_id
      AND u.auth_user_id = NULLIF(auth.user_id(), '')::uuid
      AND u.status = 'active'
      AND m.status = 'active'
      AND (
        m.role = 'admin_organization'
        OR (m.property_id = p_property_id AND m.role IN ('owner','technician'))
      )
  )
$$;

CREATE OR REPLACE FUNCTION create_area(p_property_id uuid, p_name text, p_area_type text DEFAULT NULL, p_boundary_geojson jsonb DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_id uuid;
  v_org uuid;
  v_user uuid := app_current_user_id();
  v_geom geometry;
BEGIN
  IF NULLIF(trim(p_name), '') IS NULL THEN RAISE EXCEPTION 'area_name_required'; END IF;
  IF NOT app_can_manage_property(p_property_id) THEN RAISE EXCEPTION 'property_management_required'; END IF;

  SELECT organization_id INTO v_org FROM properties WHERE id = p_property_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'property_not_found'; END IF;

  IF p_boundary_geojson IS NOT NULL THEN
    v_geom := ST_SetSRID(ST_GeomFromGeoJSON(p_boundary_geojson), 4326);
    IF GeometryType(v_geom) NOT IN ('POLYGON','MULTIPOLYGON') THEN RAISE EXCEPTION 'area_boundary_must_be_polygon'; END IF;
    IF NOT ST_IsValid(v_geom) THEN RAISE EXCEPTION 'invalid_area_boundary'; END IF;
  END IF;

  INSERT INTO areas(organization_id, property_id, name, area_type, boundary)
  VALUES (v_org, p_property_id, trim(p_name), NULLIF(trim(p_area_type), ''), CASE WHEN v_geom IS NULL THEN NULL ELSE ST_Multi(v_geom)::geometry(MultiPolygon,4326) END)
  RETURNING id INTO v_id;

  INSERT INTO audit_logs(organization_id, actor_user_id, action, entity_type, entity_id, details)
  VALUES (v_org, v_user, 'area.created', 'area', v_id::text, jsonb_build_object('name', trim(p_name), 'property_id', p_property_id));
  RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION register_device(
  p_scope text,
  p_neighborhood_id uuid,
  p_property_id uuid,
  p_area_id uuid,
  p_device_type text,
  p_name text,
  p_manufacturer text DEFAULT NULL,
  p_model text DEFAULT NULL,
  p_serial_number text DEFAULT NULL,
  p_firmware_version text DEFAULT NULL,
  p_latitude double precision DEFAULT NULL,
  p_longitude double precision DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_id uuid;
  v_org uuid;
  v_neighborhood uuid;
  v_user uuid := app_current_user_id();
  v_community boolean;
BEGIN
  IF p_scope NOT IN ('community','private') THEN RAISE EXCEPTION 'invalid_device_scope'; END IF;
  IF p_device_type NOT IN ('camera','sensor','gateway','nvr','gps','siren','panic') THEN RAISE EXCEPTION 'invalid_device_type'; END IF;
  IF NULLIF(trim(p_name), '') IS NULL THEN RAISE EXCEPTION 'device_name_required'; END IF;
  IF (p_latitude IS NULL) <> (p_longitude IS NULL) THEN RAISE EXCEPTION 'latitude_longitude_pair_required'; END IF;
  IF p_latitude IS NOT NULL AND (p_latitude < -90 OR p_latitude > 90 OR p_longitude < -180 OR p_longitude > 180) THEN RAISE EXCEPTION 'invalid_coordinates'; END IF;

  IF p_scope = 'community' THEN
    IF p_neighborhood_id IS NULL OR p_property_id IS NOT NULL OR p_area_id IS NOT NULL THEN RAISE EXCEPTION 'community_device_scope_mismatch'; END IF;
    IF NOT app_can_manage_neighborhood(p_neighborhood_id) THEN RAISE EXCEPTION 'neighborhood_management_required'; END IF;
    SELECT organization_id INTO v_org FROM neighborhoods WHERE id = p_neighborhood_id;
    v_neighborhood := p_neighborhood_id;
    v_community := true;
  ELSE
    IF p_property_id IS NULL THEN RAISE EXCEPTION 'private_device_requires_property'; END IF;
    IF NOT app_can_manage_property(p_property_id) THEN RAISE EXCEPTION 'property_management_required'; END IF;
    SELECT organization_id, neighborhood_id INTO v_org, v_neighborhood FROM properties WHERE id = p_property_id;
    IF p_area_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM areas WHERE id = p_area_id AND property_id = p_property_id) THEN RAISE EXCEPTION 'area_scope_mismatch'; END IF;
    v_community := false;
  END IF;

  IF v_org IS NULL THEN RAISE EXCEPTION 'device_scope_not_found'; END IF;

  INSERT INTO devices(organization_id, neighborhood_id, property_id, area_id, device_type, name, manufacturer, model, serial_number, firmware_version, status, community_shared, location)
  VALUES (v_org, v_neighborhood, p_property_id, p_area_id, p_device_type::device_type, trim(p_name), NULLIF(trim(p_manufacturer), ''), NULLIF(trim(p_model), ''), NULLIF(trim(p_serial_number), ''), NULLIF(trim(p_firmware_version), ''), 'offline'::device_status, v_community, CASE WHEN p_latitude IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint(p_longitude, p_latitude),4326)::geography END)
  RETURNING id INTO v_id;

  INSERT INTO audit_logs(organization_id, actor_user_id, action, entity_type, entity_id, details)
  VALUES (v_org, v_user, 'device.registered', 'device', v_id::text, jsonb_build_object('name', trim(p_name), 'scope', p_scope, 'device_type', p_device_type, 'property_id', p_property_id, 'neighborhood_id', v_neighborhood));
  RETURN v_id;
END
$$;
