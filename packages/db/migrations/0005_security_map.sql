CREATE OR REPLACE FUNCTION public.set_property_location(
  p_property_id uuid,
  p_latitude double precision,
  p_longitude double precision
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path=public,auth,pg_temp
AS $$
DECLARE
  v_org uuid;
BEGIN
  IF p_latitude IS NULL OR p_longitude IS NULL OR p_latitude < -90 OR p_latitude > 90 OR p_longitude < -180 OR p_longitude > 180 THEN
    RAISE EXCEPTION 'invalid_coordinates';
  END IF;
  SELECT organization_id INTO v_org FROM public.properties WHERE id=p_property_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'property_not_found'; END IF;
  IF NOT public.app_can_manage_property(p_property_id) THEN RAISE EXCEPTION 'property_management_required'; END IF;
  UPDATE public.properties
     SET centroid=ST_SetSRID(ST_MakePoint(p_longitude,p_latitude),4326)::geography
   WHERE id=p_property_id;
  INSERT INTO public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
  VALUES(v_org,public.app_current_user_id(),'property.location.updated','property',p_property_id::text,jsonb_build_object('latitude',p_latitude,'longitude',p_longitude));
  RETURN p_property_id;
END $$;
GRANT EXECUTE ON FUNCTION public.set_property_location(uuid,double precision,double precision) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_property_boundary(p_property_id uuid, p_boundary_geojson jsonb) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path=public,auth,pg_temp
AS $$
DECLARE
  v_org uuid;
  v_geom geometry;
BEGIN
  SELECT organization_id INTO v_org FROM public.properties WHERE id=p_property_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'property_not_found'; END IF;
  IF NOT public.app_can_manage_property(p_property_id) THEN RAISE EXCEPTION 'property_management_required'; END IF;
  BEGIN
    v_geom:=ST_SetSRID(ST_GeomFromGeoJSON(p_boundary_geojson::text),4326);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'invalid_geojson';
  END;
  IF GeometryType(v_geom) NOT IN ('POLYGON','MULTIPOLYGON') OR NOT ST_IsValid(v_geom) THEN RAISE EXCEPTION 'invalid_property_boundary'; END IF;
  UPDATE public.properties
     SET boundary=ST_Multi(ST_Force2D(v_geom))::geometry(MultiPolygon,4326),
         centroid=ST_Centroid(ST_Multi(ST_Force2D(v_geom)))::geography
   WHERE id=p_property_id;
  INSERT INTO public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
  VALUES(v_org,public.app_current_user_id(),'property.boundary.updated','property',p_property_id::text,jsonb_build_object('source','geojson'));
  RETURN p_property_id;
END $$;
GRANT EXECUTE ON FUNCTION public.set_property_boundary(uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_area_boundary(p_area_id uuid, p_boundary_geojson jsonb) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path=public,auth,pg_temp
AS $$
DECLARE
  v_org uuid;
  v_property uuid;
  v_geom geometry;
BEGIN
  SELECT organization_id,property_id INTO v_org,v_property FROM public.areas WHERE id=p_area_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'area_not_found'; END IF;
  IF NOT public.app_can_manage_property(v_property) THEN RAISE EXCEPTION 'property_management_required'; END IF;
  BEGIN
    v_geom:=ST_SetSRID(ST_GeomFromGeoJSON(p_boundary_geojson::text),4326);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'invalid_geojson';
  END;
  IF GeometryType(v_geom) NOT IN ('POLYGON','MULTIPOLYGON') OR NOT ST_IsValid(v_geom) THEN RAISE EXCEPTION 'invalid_area_boundary'; END IF;
  UPDATE public.areas SET boundary=ST_Multi(ST_Force2D(v_geom))::geometry(MultiPolygon,4326) WHERE id=p_area_id;
  INSERT INTO public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
  VALUES(v_org,public.app_current_user_id(),'area.boundary.updated','area',p_area_id::text,jsonb_build_object('source','geojson'));
  RETURN p_area_id;
END $$;
GRANT EXECUTE ON FUNCTION public.set_area_boundary(uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_security_map()
RETURNS TABLE(
  feature_type text,
  feature_id uuid,
  name text,
  scope text,
  subtype text,
  status text,
  latitude double precision,
  longitude double precision,
  organization_id uuid,
  neighborhood_id uuid,
  property_id uuid,
  area_id uuid,
  geometry_geojson jsonb
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path=public,auth,pg_temp
AS $$
  SELECT 'property'::text,p.id,p.name,'private'::text,'property'::text,'active'::text,
         CASE WHEN p.centroid IS NOT NULL THEN ST_Y(p.centroid::geometry) WHEN p.boundary IS NOT NULL THEN ST_Y(ST_Centroid(p.boundary)) ELSE NULL END,
         CASE WHEN p.centroid IS NOT NULL THEN ST_X(p.centroid::geometry) WHEN p.boundary IS NOT NULL THEN ST_X(ST_Centroid(p.boundary)) ELSE NULL END,
         p.organization_id,p.neighborhood_id,p.id,NULL::uuid,
         CASE WHEN p.boundary IS NOT NULL THEN ST_AsGeoJSON(p.boundary)::jsonb ELSE NULL END
    FROM public.properties p
   WHERE p.centroid IS NOT NULL OR p.boundary IS NOT NULL
  UNION ALL
  SELECT 'area'::text,a.id,a.name,'private'::text,COALESCE(a.area_type,'area'),'active'::text,
         CASE WHEN a.boundary IS NOT NULL THEN ST_Y(ST_Centroid(a.boundary)) ELSE NULL END,
         CASE WHEN a.boundary IS NOT NULL THEN ST_X(ST_Centroid(a.boundary)) ELSE NULL END,
         a.organization_id,p.neighborhood_id,a.property_id,a.id,
         CASE WHEN a.boundary IS NOT NULL THEN ST_AsGeoJSON(a.boundary)::jsonb ELSE NULL END
    FROM public.areas a
    JOIN public.properties p ON p.id=a.property_id
   WHERE a.boundary IS NOT NULL
  UNION ALL
  SELECT 'device'::text,d.id,d.name,CASE WHEN d.community_shared THEN 'community' ELSE 'private' END,d.device_type::text,d.status::text,
         CASE WHEN d.location IS NOT NULL THEN ST_Y(d.location::geometry) ELSE NULL END,
         CASE WHEN d.location IS NOT NULL THEN ST_X(d.location::geometry) ELSE NULL END,
         d.organization_id,d.neighborhood_id,d.property_id,d.area_id,NULL::jsonb
    FROM public.devices d
   WHERE d.location IS NOT NULL
  UNION ALL
  SELECT 'incident'::text,i.id,i.title,CASE WHEN i.property_id IS NOT NULL THEN 'private' ELSE 'community' END,'incident'::text,i.status::text,
         CASE WHEN p.centroid IS NOT NULL THEN ST_Y(p.centroid::geometry) WHEN n.boundary IS NOT NULL THEN ST_Y(ST_Centroid(n.boundary)) ELSE NULL END,
         CASE WHEN p.centroid IS NOT NULL THEN ST_X(p.centroid::geometry) WHEN n.boundary IS NOT NULL THEN ST_X(ST_Centroid(n.boundary)) ELSE NULL END,
         i.organization_id,i.neighborhood_id,i.property_id,NULL::uuid,NULL::jsonb
    FROM public.incidents i
    LEFT JOIN public.properties p ON p.id=i.property_id
    LEFT JOIN public.neighborhoods n ON n.id=i.neighborhood_id
   WHERE p.centroid IS NOT NULL OR n.boundary IS NOT NULL;
$$;
GRANT EXECUTE ON FUNCTION public.get_security_map() TO authenticated;
