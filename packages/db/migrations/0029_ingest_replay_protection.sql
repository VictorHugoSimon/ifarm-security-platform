-- SEC-194 — Replay protection / ingest idempotency.
DO $$
BEGIN
  IF to_regprocedure('public.ingest_device_heartbeat(uuid,text,text,device_status,timestamptz,numeric,integer,text,jsonb)') IS NOT NULL
     AND to_regprocedure('public.ingest_device_heartbeat_legacy_impl(uuid,text,text,device_status,timestamptz,numeric,integer,text,jsonb)') IS NULL THEN
    ALTER FUNCTION public.ingest_device_heartbeat(uuid,text,text,device_status,timestamptz,numeric,integer,text,jsonb) RENAME TO ingest_device_heartbeat_legacy_impl;
  END IF;
  IF to_regprocedure('public.ingest_asset_position(uuid,uuid,text,text,timestamptz,double precision,double precision,numeric,numeric,numeric,jsonb)') IS NOT NULL
     AND to_regprocedure('public.ingest_asset_position_legacy_impl(uuid,uuid,text,text,timestamptz,double precision,double precision,numeric,numeric,numeric,jsonb)') IS NULL THEN
    ALTER FUNCTION public.ingest_asset_position(uuid,uuid,text,text,timestamptz,double precision,double precision,numeric,numeric,numeric,jsonb) RENAME TO ingest_asset_position_legacy_impl;
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION public.ingest_device_heartbeat_legacy_impl(uuid,text,text,device_status,timestamptz,numeric,integer,text,jsonb) FROM PUBLIC, authenticated, anonymous;
REVOKE EXECUTE ON FUNCTION public.ingest_asset_position_legacy_impl(uuid,uuid,text,text,timestamptz,double precision,double precision,numeric,numeric,numeric,jsonb) FROM PUBLIC, authenticated, anonymous;

CREATE OR REPLACE FUNCTION public.ingest_device_heartbeat(
  p_device_id uuid,p_key_hash text,p_event_id text,p_status device_status,p_source_at timestamptz DEFAULT NULL,p_battery_pct numeric DEFAULT NULL,p_signal_rssi integer DEFAULT NULL,p_connection_type text DEFAULT NULL,p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE(accepted boolean,current_status device_status,received_at timestamptz,transition text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF p_event_id IS NULL OR p_event_id !~ '^[A-Za-z0-9._:-]{1,128}$' THEN RAISE EXCEPTION 'invalid_event_id'; END IF;
  RETURN QUERY SELECT CASE WHEN x.transition='duplicate' THEN false ELSE x.accepted END,x.current_status,x.received_at,x.transition
  FROM public.ingest_device_heartbeat_legacy_impl(p_device_id,p_key_hash,p_event_id,p_status,p_source_at,p_battery_pct,p_signal_rssi,p_connection_type,p_metadata) x;
EXCEPTION WHEN unique_violation THEN
  RETURN QUERY SELECT false,t.status,t.received_at,'duplicate'::text FROM public.device_telemetry t WHERE t.device_id=p_device_id AND t.event_id=p_event_id ORDER BY t.received_at DESC LIMIT 1;
  IF NOT FOUND THEN RAISE; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.ingest_asset_position(
  p_asset_id uuid,p_device_id uuid,p_key_hash text,p_source_event_id text,p_recorded_at timestamptz,p_latitude double precision,p_longitude double precision,p_speed_kmh numeric DEFAULT NULL,p_heading_degrees numeric DEFAULT NULL,p_accuracy_m numeric DEFAULT NULL,p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE(accepted boolean,inside_geofence boolean,transition text,received_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF p_source_event_id IS NULL OR p_source_event_id !~ '^[A-Za-z0-9._:-]{1,128}$' THEN RAISE EXCEPTION 'invalid_event_id'; END IF;
  RETURN QUERY SELECT x.accepted,x.inside_geofence,x.transition,x.received_at
  FROM public.ingest_asset_position_legacy_impl(p_asset_id,p_device_id,p_key_hash,p_source_event_id,p_recorded_at,p_latitude,p_longitude,p_speed_kmh,p_heading_degrees,p_accuracy_m,p_metadata) x;
END $$;

REVOKE EXECUTE ON FUNCTION public.ingest_device_heartbeat(uuid,text,text,device_status,timestamptz,numeric,integer,text,jsonb) FROM PUBLIC, authenticated, anonymous;
REVOKE EXECUTE ON FUNCTION public.ingest_asset_position(uuid,uuid,text,text,timestamptz,double precision,double precision,numeric,numeric,numeric,jsonb) FROM PUBLIC, authenticated, anonymous;
