-- SEC-195 — Idempotency conflict detection.
-- A stable event id may be retried only with the same semantic payload.

CREATE OR REPLACE FUNCTION public.ingest_device_heartbeat(
  p_device_id uuid,p_key_hash text,p_event_id text,p_status device_status,p_source_at timestamptz DEFAULT NULL,p_battery_pct numeric DEFAULT NULL,p_signal_rssi integer DEFAULT NULL,p_connection_type text DEFAULT NULL,p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE(accepted boolean,current_status device_status,received_at timestamptz,transition text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_row record;
  v_existing public.device_telemetry%ROWTYPE;
BEGIN
  IF p_event_id IS NULL OR p_event_id !~ '^[A-Za-z0-9._:-]{1,128}$' THEN RAISE EXCEPTION 'invalid_event_id'; END IF;

  BEGIN
    SELECT * INTO v_row
    FROM public.ingest_device_heartbeat_legacy_impl(
      p_device_id,p_key_hash,p_event_id,p_status,p_source_at,p_battery_pct,p_signal_rssi,p_connection_type,p_metadata
    );
  EXCEPTION WHEN unique_violation THEN
    SELECT false AS accepted,t.status AS current_status,t.received_at,'duplicate'::text AS transition
      INTO v_row
      FROM public.device_telemetry t
     WHERE t.device_id=p_device_id AND t.event_id=p_event_id
     ORDER BY t.received_at DESC LIMIT 1;
    IF NOT FOUND THEN RAISE; END IF;
  END;

  IF v_row.transition='duplicate' THEN
    SELECT * INTO v_existing
      FROM public.device_telemetry t
     WHERE t.device_id=p_device_id AND t.event_id=p_event_id
     ORDER BY t.received_at DESC LIMIT 1;

    IF NOT FOUND
       OR v_existing.status IS DISTINCT FROM p_status
       OR v_existing.source_at IS DISTINCT FROM p_source_at
       OR v_existing.battery_pct IS DISTINCT FROM p_battery_pct
       OR v_existing.signal_rssi IS DISTINCT FROM p_signal_rssi
       OR v_existing.connection_type IS DISTINCT FROM nullif(trim(p_connection_type),'')
       OR v_existing.metadata IS DISTINCT FROM coalesce(p_metadata,'{}'::jsonb) THEN
      RAISE EXCEPTION 'event_id_conflict';
    END IF;
  END IF;

  RETURN QUERY SELECT CASE WHEN v_row.transition='duplicate' THEN false ELSE v_row.accepted END,v_row.current_status,v_row.received_at,v_row.transition;
END $$;

CREATE OR REPLACE FUNCTION public.ingest_asset_position(
  p_asset_id uuid,p_device_id uuid,p_key_hash text,p_source_event_id text,p_recorded_at timestamptz,p_latitude double precision,p_longitude double precision,p_speed_kmh numeric DEFAULT NULL,p_heading_degrees numeric DEFAULT NULL,p_accuracy_m numeric DEFAULT NULL,p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE(accepted boolean,inside_geofence boolean,transition text,received_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_row record;
  v_existing record;
BEGIN
  IF p_source_event_id IS NULL OR p_source_event_id !~ '^[A-Za-z0-9._:-]{1,128}$' THEN RAISE EXCEPTION 'invalid_event_id'; END IF;

  SELECT * INTO v_row
  FROM public.ingest_asset_position_legacy_impl(
    p_asset_id,p_device_id,p_key_hash,p_source_event_id,p_recorded_at,p_latitude,p_longitude,p_speed_kmh,p_heading_degrees,p_accuracy_m,p_metadata
  );

  IF v_row.transition='duplicate' OR v_row.accepted=false THEN
    SELECT ap.device_id,ap.recorded_at,ST_Y(ap.position::geometry) AS latitude,ST_X(ap.position::geometry) AS longitude,
           ap.speed_kmh,ap.heading_degrees,ap.accuracy_m,ap.metadata
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

REVOKE EXECUTE ON FUNCTION public.ingest_device_heartbeat(uuid,text,text,device_status,timestamptz,numeric,integer,text,jsonb) FROM PUBLIC,authenticated,anonymous;
REVOKE EXECUTE ON FUNCTION public.ingest_asset_position(uuid,uuid,text,text,timestamptz,double precision,double precision,numeric,numeric,numeric,jsonb) FROM PUBLIC,authenticated,anonymous;

COMMENT ON FUNCTION public.ingest_device_heartbeat(uuid,text,text,device_status,timestamptz,numeric,integer,text,jsonb)
  IS 'Replay-safe server ingest. A repeated event id must match the original semantic payload or event_id_conflict is raised.';
COMMENT ON FUNCTION public.ingest_asset_position(uuid,uuid,text,text,timestamptz,double precision,double precision,numeric,numeric,numeric,jsonb)
  IS 'Replay-safe server ingest. A repeated source event id must match the original semantic payload or event_id_conflict is raised.';
