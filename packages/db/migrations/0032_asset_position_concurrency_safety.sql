-- SEC-199 — Concurrent asset position ordering safety.
-- Rural buffers can flush more than one GPS position concurrently. Serialize ingest per asset
-- so the legacy last_position_at ordering rule cannot race and let an older position win.

CREATE OR REPLACE FUNCTION public.ingest_asset_position(
  p_asset_id uuid,
  p_device_id uuid,
  p_key_hash text,
  p_source_event_id text,
  p_recorded_at timestamptz,
  p_latitude double precision,
  p_longitude double precision,
  p_speed_kmh numeric DEFAULT NULL,
  p_heading_degrees numeric DEFAULT NULL,
  p_accuracy_m numeric DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE(accepted boolean,inside_geofence boolean,transition text,received_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_row record;
  v_existing record;
BEGIN
  IF p_source_event_id IS NULL OR p_source_event_id !~ '^[A-Za-z0-9._:-]{1,128}$' THEN
    RAISE EXCEPTION 'invalid_event_id';
  END IF;

  -- Transaction-scoped and asset-scoped. Hash collisions can only serialize extra work;
  -- they cannot weaken correctness or expand tenant access.
  PERFORM pg_advisory_xact_lock(
    hashtext('ifarm_security_asset_position'),
    hashtext(p_asset_id::text)
  );

  SELECT * INTO v_row
  FROM public.ingest_asset_position_legacy_impl(
    p_asset_id,p_device_id,p_key_hash,p_source_event_id,p_recorded_at,p_latitude,p_longitude,
    p_speed_kmh,p_heading_degrees,p_accuracy_m,p_metadata
  );

  IF v_row.transition='duplicate' OR v_row.accepted=false THEN
    SELECT ap.device_id,ap.recorded_at,ST_Y(ap.position::geometry) AS latitude,
           ST_X(ap.position::geometry) AS longitude,ap.speed_kmh,ap.heading_degrees,
           ap.accuracy_m,ap.metadata
      INTO v_existing
      FROM public.asset_positions ap
     WHERE ap.asset_id=p_asset_id AND ap.source_event_id=p_source_event_id
     ORDER BY ap.received_at DESC LIMIT 1;

    IF NOT FOUND
       OR v_existing.device_id IS DISTINCT FROM p_device_id
       OR v_existing.recorded_at IS DISTINCT FROM p_recorded_at
       OR v_existing.latitude IS DISTINCT FROM p_latitude
       OR v_existing.longitude IS DISTINCT FROM p_longitude
       OR v_existing.speed_kmh IS DISTINCT FROM p_speed_kmh
       OR v_existing.heading_degrees IS DISTINCT FROM p_heading_degrees
       OR v_existing.accuracy_m IS DISTINCT FROM p_accuracy_m
       OR v_existing.metadata IS DISTINCT FROM coalesce(p_metadata,'{}'::jsonb) THEN
      RAISE EXCEPTION 'event_id_conflict';
    END IF;
  END IF;

  RETURN QUERY SELECT v_row.accepted,v_row.inside_geofence,v_row.transition,v_row.received_at;
END $$;

REVOKE EXECUTE ON FUNCTION public.ingest_asset_position(uuid,uuid,text,text,timestamptz,double precision,double precision,numeric,numeric,numeric,jsonb)
  FROM PUBLIC,authenticated,anonymous;

COMMENT ON FUNCTION public.ingest_asset_position(uuid,uuid,text,text,timestamptz,double precision,double precision,numeric,numeric,numeric,jsonb)
  IS 'Server-only replay-safe GPS ingest serialized per asset. Historical positions remain stored while concurrent requests cannot regress current asset state.';
