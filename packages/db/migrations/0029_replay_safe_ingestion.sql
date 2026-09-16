-- SEC-194 — replay-safe ingestion for rural offline/buffered connectivity.
-- eventId becomes mandatory for external ingest RPCs. Duplicate delivery is atomic and returns accepted=false.
-- Historical buffered heartbeat/position samples are recorded but cannot roll current state backwards.

CREATE OR REPLACE FUNCTION public.ingest_device_heartbeat(
  p_device_id uuid,
  p_key_hash text,
  p_event_id text,
  p_status device_status,
  p_source_at timestamptz DEFAULT NULL,
  p_battery_pct numeric DEFAULT NULL,
  p_signal_rssi integer DEFAULT NULL,
  p_connection_type text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE(
  accepted boolean,
  current_status device_status,
  received_at timestamptz,
  transition text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key uuid;
  v_org uuid;
  v_old_status device_status;
  v_neighborhood uuid;
  v_property uuid;
  v_device_type device_type;
  v_received timestamptz := now();
  v_existing_status device_status;
  v_existing_received timestamptz;
  v_transition text := 'heartbeat';
  v_severity alert_severity;
  v_inserted bigint;
  v_latest_effective timestamptz;
  v_event_id text := nullif(btrim(p_event_id), '');
BEGIN
  IF p_key_hash IS NULL OR p_key_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_device_key';
  END IF;
  IF v_event_id IS NULL OR length(v_event_id) > 128 THEN
    RAISE EXCEPTION 'invalid_event_id';
  END IF;
  IF p_source_at IS NOT NULL AND p_source_at > now() + interval '10 minutes' THEN
    RAISE EXCEPTION 'source_time_in_future';
  END IF;
  IF p_battery_pct IS NOT NULL AND (p_battery_pct < 0 OR p_battery_pct > 100) THEN
    RAISE EXCEPTION 'invalid_battery';
  END IF;
  IF p_signal_rssi IS NOT NULL AND (p_signal_rssi < -200 OR p_signal_rssi > 0) THEN
    RAISE EXCEPTION 'invalid_signal';
  END IF;
  IF p_connection_type IS NOT NULL AND length(p_connection_type) > 32 THEN
    RAISE EXCEPTION 'invalid_connection_type';
  END IF;
  IF octet_length(coalesce(p_metadata, '{}'::jsonb)::text) > 8192 THEN
    RAISE EXCEPTION 'metadata_too_large';
  END IF;

  SELECT k.id, d.organization_id, d.status, d.neighborhood_id, d.property_id, d.device_type
    INTO v_key, v_org, v_old_status, v_neighborhood, v_property, v_device_type
    FROM public.device_ingest_keys k
    JOIN public.devices d ON d.id = k.device_id
   WHERE k.device_id = p_device_id
     AND k.key_hash = lower(p_key_hash)
     AND k.status = 'active'
     AND k.expires_at > v_received
   LIMIT 1
   FOR UPDATE OF d;

  IF v_key IS NULL THEN
    RAISE EXCEPTION 'invalid_device_key';
  END IF;

  UPDATE public.device_ingest_keys SET last_used_at = v_received WHERE id = v_key;

  INSERT INTO public.device_telemetry(
    organization_id, device_id, event_id, status, source_at, received_at,
    battery_pct, signal_rssi, connection_type, metadata
  ) VALUES (
    v_org, p_device_id, v_event_id, p_status, p_source_at, v_received,
    p_battery_pct, p_signal_rssi, nullif(trim(p_connection_type), ''), coalesce(p_metadata, '{}'::jsonb)
  )
  ON CONFLICT (device_id, event_id) WHERE event_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_inserted;

  IF v_inserted IS NULL THEN
    SELECT t.status, t.received_at
      INTO v_existing_status, v_existing_received
      FROM public.device_telemetry t
     WHERE t.device_id = p_device_id AND t.event_id = v_event_id
     LIMIT 1;
    RETURN QUERY SELECT false, v_existing_status, v_existing_received, 'duplicate'::text;
    RETURN;
  END IF;

  SELECT max(coalesce(t.source_at, t.received_at))
    INTO v_latest_effective
    FROM public.device_telemetry t
   WHERE t.device_id = p_device_id AND t.id <> v_inserted;

  IF p_source_at IS NOT NULL AND v_latest_effective IS NOT NULL AND p_source_at < v_latest_effective THEN
    RETURN QUERY SELECT true, v_old_status, v_received, 'historical'::text;
    RETURN;
  END IF;

  IF v_old_status IS DISTINCT FROM p_status THEN
    IF v_old_status = 'offline' AND p_status = 'online' THEN v_transition := 'restored';
    ELSIF p_status = 'offline' THEN v_transition := 'offline';
    ELSIF p_status = 'degraded' THEN v_transition := 'degraded';
    ELSE v_transition := 'status_changed';
    END IF;

    v_severity := CASE
      WHEN p_status = 'offline' AND v_device_type IN ('gateway', 'nvr') THEN 'high'::alert_severity
      WHEN p_status IN ('offline', 'degraded') THEN 'attention'::alert_severity
      ELSE 'informational'::alert_severity
    END;

    INSERT INTO public.security_events(
      organization_id, neighborhood_id, property_id, device_id,
      event_type, severity, human_validation_status, occurred_at, metadata
    ) VALUES (
      v_org, v_neighborhood, v_property, p_device_id,
      CASE WHEN v_transition = 'restored' THEN 'device.restored'
           WHEN v_transition = 'offline' THEN 'device.offline'
           WHEN v_transition = 'degraded' THEN 'device.degraded'
           ELSE 'device.status_changed' END,
      v_severity, 'not_required', coalesce(p_source_at, v_received),
      jsonb_build_object('old_status', v_old_status, 'new_status', p_status, 'source', 'heartbeat', 'source_event_id', v_event_id)
    );
  END IF;

  UPDATE public.devices
     SET status = p_status,
         last_seen_at = v_received,
         last_status_changed_at = CASE WHEN v_old_status IS DISTINCT FROM p_status THEN v_received ELSE last_status_changed_at END
   WHERE id = p_device_id;

  RETURN QUERY SELECT true, p_status, v_received, v_transition;
END
$$;

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
)
RETURNS TABLE(accepted boolean, inside_geofence boolean, transition text, received_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org uuid;
  v_prop uuid;
  v_neigh uuid;
  v_linked_device uuid;
  v_geofence geometry(Polygon, 4326);
  v_enabled boolean;
  v_previous text;
  v_last_position timestamptz;
  v_point geography(Point, 4326);
  v_inside boolean;
  v_new_state text;
  v_transition text := 'none';
  v_received timestamptz := now();
  v_inserted bigint;
  v_event_type text;
  v_severity alert_severity;
  v_event_id text := nullif(btrim(p_source_event_id), '');
BEGIN
  IF v_event_id IS NULL OR length(v_event_id) > 128 THEN
    RAISE EXCEPTION 'invalid_event_id';
  END IF;
  IF p_latitude NOT BETWEEN -90 AND 90 OR p_longitude NOT BETWEEN -180 AND 180 THEN RAISE EXCEPTION 'invalid_coordinates'; END IF;
  IF p_recorded_at IS NULL OR p_recorded_at > now() + interval '10 minutes' THEN RAISE EXCEPTION 'invalid_recorded_at'; END IF;
  IF p_speed_kmh IS NOT NULL AND p_speed_kmh < 0 THEN RAISE EXCEPTION 'invalid_speed'; END IF;
  IF p_heading_degrees IS NOT NULL AND (p_heading_degrees < 0 OR p_heading_degrees >= 360) THEN RAISE EXCEPTION 'invalid_heading'; END IF;
  IF p_accuracy_m IS NOT NULL AND p_accuracy_m < 0 THEN RAISE EXCEPTION 'invalid_accuracy'; END IF;

  SELECT a.organization_id, a.property_id, p.neighborhood_id, a.device_id,
         a.geofence, a.geofence_enabled, a.geofence_state, a.last_position_at
    INTO v_org, v_prop, v_neigh, v_linked_device, v_geofence, v_enabled, v_previous, v_last_position
    FROM public.assets a JOIN public.properties p ON p.id = a.property_id
   WHERE a.id = p_asset_id
   FOR UPDATE OF a;

  IF NOT FOUND THEN RAISE EXCEPTION 'asset_not_found'; END IF;
  IF v_linked_device IS NULL OR v_linked_device <> p_device_id THEN RAISE EXCEPTION 'asset_device_mismatch'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.device_ingest_keys k
     WHERE k.device_id = p_device_id AND k.organization_id = v_org
       AND k.key_hash = lower(p_key_hash) AND k.status = 'active' AND k.expires_at > now()
  ) THEN RAISE EXCEPTION 'invalid_device_key'; END IF;

  UPDATE public.device_ingest_keys SET last_used_at = now()
   WHERE device_id = p_device_id AND key_hash = lower(p_key_hash) AND status = 'active';

  v_point := ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::geography;
  IF v_enabled AND v_geofence IS NOT NULL THEN v_inside := ST_Covers(v_geofence, v_point::geometry); ELSE v_inside := NULL; END IF;

  INSERT INTO public.asset_positions(
    organization_id, asset_id, device_id, source_event_id, position, recorded_at, received_at,
    speed_kmh, heading_degrees, accuracy_m, inside_geofence, metadata
  ) VALUES (
    v_org, p_asset_id, p_device_id, v_event_id, v_point, p_recorded_at, v_received,
    p_speed_kmh, p_heading_degrees, p_accuracy_m, v_inside, coalesce(p_metadata, '{}'::jsonb)
  )
  ON CONFLICT (asset_id, source_event_id) WHERE source_event_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_inserted;

  IF v_inserted IS NULL THEN
    RETURN QUERY SELECT false, ap.inside_geofence, 'duplicate'::text, ap.received_at
      FROM public.asset_positions ap
     WHERE ap.asset_id = p_asset_id AND ap.source_event_id = v_event_id
     LIMIT 1;
    RETURN;
  END IF;

  IF v_last_position IS NULL OR p_recorded_at >= v_last_position THEN
    IF v_enabled AND v_geofence IS NOT NULL THEN v_new_state := CASE WHEN v_inside THEN 'inside' ELSE 'outside' END; ELSE v_new_state := 'unknown'; END IF;
    UPDATE public.assets SET location = v_point, last_position_at = p_recorded_at, geofence_state = v_new_state, updated_at = now() WHERE id = p_asset_id;

    IF v_enabled AND v_geofence IS NOT NULL THEN
      IF v_previous = 'inside' AND v_new_state = 'outside' THEN v_transition := 'exit'; v_event_type := 'asset_geofence_exit'; v_severity := 'high';
      ELSIF v_previous = 'outside' AND v_new_state = 'inside' THEN v_transition := 'return'; v_event_type := 'asset_geofence_return'; v_severity := 'informational';
      ELSIF v_previous = 'unknown' AND v_new_state = 'outside' THEN v_transition := 'outside_detected'; v_event_type := 'asset_geofence_outside_detected'; v_severity := 'attention';
      END IF;
      IF v_event_type IS NOT NULL THEN
        INSERT INTO public.security_events(
          organization_id, neighborhood_id, property_id, device_id, asset_id,
          event_type, severity, confidence, human_validation_status, occurred_at, metadata
        ) VALUES (
          v_org, v_neigh, v_prop, p_device_id, p_asset_id, v_event_type, v_severity, NULL, 'not_required', p_recorded_at,
          jsonb_build_object('source', 'asset_geofence_rule', 'source_event_id', v_event_id, 'latitude', p_latitude, 'longitude', p_longitude, 'speedKmh', p_speed_kmh, 'accuracyM', p_accuracy_m, 'geofenceState', v_new_state)
        );
      END IF;
    END IF;
  ELSE
    v_transition := 'historical';
  END IF;

  RETURN QUERY SELECT true, v_inside, v_transition, v_received;
END
$$;

REVOKE ALL ON FUNCTION public.ingest_device_heartbeat(uuid, text, text, device_status, timestamptz, numeric, integer, text, jsonb) FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON FUNCTION public.ingest_asset_position(uuid, uuid, text, text, timestamptz, double precision, double precision, numeric, numeric, numeric, jsonb) FROM PUBLIC, anonymous, authenticated;

COMMENT ON FUNCTION public.ingest_device_heartbeat(uuid, text, text, device_status, timestamptz, numeric, integer, text, jsonb)
IS 'Replay-safe heartbeat ingest. Requires event id, serializes per-device state, returns accepted=false for duplicates and records old buffered heartbeats as historical without rolling state backwards.';
COMMENT ON FUNCTION public.ingest_asset_position(uuid, uuid, text, text, timestamptz, double precision, double precision, numeric, numeric, numeric, jsonb)
IS 'Replay-safe asset position ingest. Requires event id, serializes per-asset geofence state, returns accepted=false for duplicates and keeps older buffered positions historical.';
