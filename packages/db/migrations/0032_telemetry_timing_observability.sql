-- SEC-199 — Telemetry delay and source-clock observability.
-- Classification is operational/technical only; it does not prove device failure, tampering or crime.

ALTER TABLE public.device_telemetry
  ADD COLUMN IF NOT EXISTS ingest_ordering text NOT NULL DEFAULT 'legacy_unknown';

DO $$
BEGIN
  ALTER TABLE public.device_telemetry
    ADD CONSTRAINT device_telemetry_ingest_ordering_allowed
    CHECK (ingest_ordering IN ('legacy_unknown','current','historical'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.device_telemetry.ingest_ordering IS
'Ordering classification assigned by server ingest. legacy_unknown is retained for telemetry created before SEC-199; current/historical apply only to classified future heartbeat ingestion.';

CREATE INDEX IF NOT EXISTS idx_device_telemetry_timing_window
  ON public.device_telemetry(device_id, received_at DESC, ingest_ordering);

CREATE OR REPLACE FUNCTION public.ingest_device_heartbeat_legacy_impl(
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
  v_last_heartbeat_source_at timestamptz;
  v_effective_source_at timestamptz;
  v_is_historical boolean;
BEGIN
  IF p_key_hash IS NULL OR p_key_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_device_key';
  END IF;
  IF p_event_id IS NOT NULL AND (length(p_event_id) = 0 OR length(p_event_id) > 128) THEN
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

  SELECT
    k.id,
    d.organization_id,
    d.status,
    d.neighborhood_id,
    d.property_id,
    d.device_type,
    d.last_heartbeat_source_at
  INTO
    v_key,
    v_org,
    v_old_status,
    v_neighborhood,
    v_property,
    v_device_type,
    v_last_heartbeat_source_at
  FROM public.device_ingest_keys k
  JOIN public.devices d ON d.id = k.device_id
  WHERE k.device_id = p_device_id
    AND k.key_hash = lower(p_key_hash)
    AND k.status = 'active'
    AND (k.expires_at IS NULL OR k.expires_at > v_received)
  LIMIT 1
  FOR UPDATE OF d;

  IF v_key IS NULL THEN
    RAISE EXCEPTION 'invalid_device_key';
  END IF;

  UPDATE public.device_ingest_keys
  SET last_used_at = v_received
  WHERE id = v_key;

  IF p_event_id IS NOT NULL THEN
    SELECT t.status, t.received_at
    INTO v_existing_status, v_existing_received
    FROM public.device_telemetry t
    WHERE t.device_id = p_device_id
      AND t.event_id = p_event_id
    LIMIT 1;

    IF FOUND THEN
      RETURN QUERY
      SELECT true, v_existing_status, v_existing_received, 'duplicate'::text;
      RETURN;
    END IF;
  END IF;

  v_effective_source_at := coalesce(p_source_at, v_received);
  v_is_historical := v_last_heartbeat_source_at IS NOT NULL
    AND v_effective_source_at <= v_last_heartbeat_source_at;

  INSERT INTO public.device_telemetry(
    organization_id,
    device_id,
    event_id,
    status,
    source_at,
    received_at,
    battery_pct,
    signal_rssi,
    connection_type,
    metadata,
    ingest_ordering
  ) VALUES (
    v_org,
    p_device_id,
    p_event_id,
    p_status,
    p_source_at,
    v_received,
    p_battery_pct,
    p_signal_rssi,
    nullif(trim(p_connection_type), ''),
    coalesce(p_metadata, '{}'::jsonb),
    CASE WHEN v_is_historical THEN 'historical' ELSE 'current' END
  );

  IF v_is_historical THEN
    RETURN QUERY
    SELECT true, v_old_status, v_received, 'historical'::text;
    RETURN;
  END IF;

  IF v_old_status IS DISTINCT FROM p_status THEN
    IF v_old_status = 'offline' AND p_status = 'online' THEN
      v_transition := 'restored';
    ELSIF p_status = 'offline' THEN
      v_transition := 'offline';
    ELSIF p_status = 'degraded' THEN
      v_transition := 'degraded';
    ELSE
      v_transition := 'status_changed';
    END IF;

    v_severity := CASE
      WHEN p_status = 'offline' AND v_device_type IN ('gateway', 'nvr') THEN 'high'::alert_severity
      WHEN p_status IN ('offline', 'degraded') THEN 'attention'::alert_severity
      ELSE 'informational'::alert_severity
    END;

    INSERT INTO public.security_events(
      organization_id,
      neighborhood_id,
      property_id,
      device_id,
      event_type,
      severity,
      human_validation_status,
      occurred_at,
      metadata
    ) VALUES (
      v_org,
      v_neighborhood,
      v_property,
      p_device_id,
      CASE
        WHEN v_transition = 'restored' THEN 'device.restored'
        WHEN v_transition = 'offline' THEN 'device.offline'
        WHEN v_transition = 'degraded' THEN 'device.degraded'
        ELSE 'device.status_changed'
      END,
      v_severity,
      'not_required',
      v_effective_source_at,
      jsonb_build_object(
        'old_status', v_old_status,
        'new_status', p_status,
        'source', 'heartbeat'
      )
    );
  END IF;

  UPDATE public.devices
  SET status = p_status,
      last_seen_at = v_received,
      last_heartbeat_source_at = v_effective_source_at,
      last_status_changed_at = CASE
        WHEN v_old_status IS DISTINCT FROM p_status THEN v_received
        ELSE last_status_changed_at
      END
  WHERE id = p_device_id;

  RETURN QUERY
  SELECT true, p_status, v_received, v_transition;
END
$$;

REVOKE EXECUTE ON FUNCTION public.ingest_device_heartbeat_legacy_impl(
  uuid,text,text,device_status,timestamptz,numeric,integer,text,jsonb
) FROM PUBLIC, authenticated, anonymous;

CREATE OR REPLACE FUNCTION public.get_operations_telemetry_timing_health(p_hours integer DEFAULT 24)
RETURNS TABLE(
  device_id uuid,
  device_name text,
  scope text,
  telemetry_rows bigint,
  historical_rows bigint,
  buffered_rows bigint,
  clock_ahead_rows bigint,
  source_time_missing_rows bigint,
  max_delay_seconds bigint,
  last_received_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  WITH authorized_devices AS (
    SELECT
      d.id,
      d.name,
      d.organization_id,
      d.neighborhood_id,
      d.property_id,
      d.offline_after_seconds
    FROM public.devices d
    WHERE public.app_has_operations_access(d.organization_id,d.neighborhood_id,d.property_id)
  ), windowed AS (
    SELECT
      d.id AS device_id,
      d.name AS device_name,
      CASE WHEN d.property_id IS NULL THEN 'community' ELSE 'private' END AS scope,
      d.offline_after_seconds,
      t.ingest_ordering,
      t.source_at,
      t.received_at
    FROM authorized_devices d
    JOIN public.device_telemetry t ON t.device_id=d.id
    WHERE t.received_at >= now() - make_interval(hours => LEAST(GREATEST(p_hours,1),168))
  )
  SELECT
    w.device_id,
    w.device_name,
    w.scope,
    count(*) AS telemetry_rows,
    count(*) FILTER (WHERE w.ingest_ordering='historical') AS historical_rows,
    count(*) FILTER (
      WHERE w.source_at IS NOT NULL
        AND w.received_at-w.source_at > make_interval(secs => GREATEST(w.offline_after_seconds,1))
    ) AS buffered_rows,
    count(*) FILTER (WHERE w.source_at > w.received_at + interval '60 seconds') AS clock_ahead_rows,
    count(*) FILTER (WHERE w.source_at IS NULL) AS source_time_missing_rows,
    COALESCE(max(
      CASE WHEN w.source_at IS NULL THEN NULL
           ELSE GREATEST(0,extract(epoch FROM (w.received_at-w.source_at)))::bigint
      END
    ),0)::bigint AS max_delay_seconds,
    max(w.received_at) AS last_received_at
  FROM windowed w
  GROUP BY w.device_id,w.device_name,w.scope
  ORDER BY
    count(*) FILTER (WHERE w.ingest_ordering='historical') DESC,
    count(*) FILTER (
      WHERE w.source_at IS NOT NULL
        AND w.received_at-w.source_at > make_interval(secs => GREATEST(w.offline_after_seconds,1))
    ) DESC,
    max(w.received_at) DESC;
$$;

REVOKE ALL ON FUNCTION public.get_operations_telemetry_timing_health(integer) FROM PUBLIC, anonymous;
GRANT EXECUTE ON FUNCTION public.get_operations_telemetry_timing_health(integer) TO authenticated;

COMMENT ON FUNCTION public.get_operations_telemetry_timing_health(integer) IS
'Authorized operational timing diagnostics only. Historical/buffered/clock indicators describe telemetry transport or device-clock quality and must not be treated as proof of device failure, tampering or criminal activity.';
