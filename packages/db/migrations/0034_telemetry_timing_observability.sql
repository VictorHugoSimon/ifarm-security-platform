-- SEC-202 — Telemetry timing observability + Operations community/privacy hardening.
-- Operational diagnostics only: timing anomalies are not evidence of failure, tampering or crime.

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
'Ordering classification assigned during server ingest. legacy_unknown is retained for rows created before timing classification; current/historical are operational transport classifications, not evidence.';

CREATE INDEX IF NOT EXISTS idx_device_telemetry_timing_window
  ON public.device_telemetry(device_id, received_at DESC, ingest_ordering);

CREATE OR REPLACE FUNCTION public.classify_device_telemetry_ordering()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_watermark timestamptz;
  v_effective_source_at timestamptz;
BEGIN
  -- Preserve an explicit classification produced by a compatible server-side ingest path.
  IF NEW.ingest_ordering IN ('current','historical') THEN
    RETURN NEW;
  END IF;

  SELECT d.last_heartbeat_source_at
  INTO v_watermark
  FROM public.devices d
  WHERE d.id = NEW.device_id;

  v_effective_source_at := coalesce(NEW.source_at, NEW.received_at, now());

  NEW.ingest_ordering := CASE
    WHEN v_watermark IS NOT NULL AND v_effective_source_at <= v_watermark THEN 'historical'
    ELSE 'current'
  END;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.classify_device_telemetry_ordering() FROM PUBLIC, anonymous, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_device_telemetry_ingest_ordering'
      AND tgrelid = 'public.device_telemetry'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER trg_device_telemetry_ingest_ordering
      BEFORE INSERT ON public.device_telemetry
      FOR EACH ROW
      EXECUTE FUNCTION public.classify_device_telemetry_ordering();
  END IF;
END $$;

-- Neighborhood administration is community-only. It must never imply private-farm Operations access.
CREATE OR REPLACE FUNCTION public.app_has_operations_access(
  p_organization_id uuid,
  p_neighborhood_id uuid,
  p_property_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public','auth'
AS $$
  SELECT public.app_is_platform_admin() OR EXISTS (
    SELECT 1
    FROM public.memberships m
    JOIN public.app_users u ON u.id = m.user_id
    WHERE m.organization_id = p_organization_id
      AND m.status = 'active'
      AND u.status = 'active'
      AND u.auth_user_id = NULLIF(auth.user_id(),'')::uuid
      AND (
        m.role = 'admin_organization'
        OR (
          m.role = 'admin_neighborhood'
          AND p_property_id IS NULL
          AND p_neighborhood_id IS NOT NULL
          AND m.neighborhood_id = p_neighborhood_id
        )
        OR (
          m.role = 'monitoring'
          AND (m.neighborhood_id IS NULL OR m.neighborhood_id = p_neighborhood_id)
          AND (m.property_id IS NULL OR m.property_id = p_property_id)
        )
      )
  )
$$;

REVOKE ALL ON FUNCTION public.app_has_operations_access(uuid,uuid,uuid) FROM PUBLIC, anonymous;
GRANT EXECUTE ON FUNCTION public.app_has_operations_access(uuid,uuid,uuid) TO authenticated;

COMMENT ON FUNCTION public.app_has_operations_access(uuid,uuid,uuid) IS
'Operations access boundary. Admin organization may operate its organization; admin neighborhood is community-only and requires property_id IS NULL; monitoring follows explicit assigned scope.';

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
    SELECT d.id,d.name,d.organization_id,d.neighborhood_id,d.property_id,d.offline_after_seconds
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
    JOIN public.device_telemetry t ON t.device_id = d.id
    WHERE t.received_at >= now() - make_interval(hours => LEAST(GREATEST(p_hours,1),168))
  )
  SELECT
    w.device_id,
    w.device_name,
    w.scope,
    count(*) AS telemetry_rows,
    count(*) FILTER (WHERE w.ingest_ordering = 'historical') AS historical_rows,
    count(*) FILTER (
      WHERE w.source_at IS NOT NULL
        AND w.received_at - w.source_at > make_interval(secs => GREATEST(w.offline_after_seconds,1))
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
  ORDER BY historical_rows DESC, buffered_rows DESC, last_received_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_operations_telemetry_timing_health(integer) FROM PUBLIC, anonymous;
GRANT EXECUTE ON FUNCTION public.get_operations_telemetry_timing_health(integer) TO authenticated;

COMMENT ON FUNCTION public.get_operations_telemetry_timing_health(integer) IS
'Authorized aggregate timing diagnostics only. No metadata, eventId, payload, evidence or recording identifiers are exposed. Historical/buffered/clock indicators are not proof of failure, tampering or crime.';
