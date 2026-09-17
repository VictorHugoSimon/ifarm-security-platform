-- SEC-200 — Deterministic GPS timestamp tie safety.
-- Two distinct GPS events with the same recorded_at have no objective temporal order.
-- Preserve both in history, but only the first observation reflected at that timestamp may define current state.

DO $$
DECLARE
  v_oid oid;
  v_definition text;
  v_old text := 'IF v_last_position IS NULL OR p_recorded_at>=v_last_position THEN';
  v_new text := 'IF v_last_position IS NULL OR p_recorded_at>v_last_position THEN';
BEGIN
  SELECT p.oid
    INTO v_oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'ingest_asset_position_legacy_impl'
   LIMIT 1;

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'ingest_asset_position_legacy_impl_not_found';
  END IF;

  SELECT pg_get_functiondef(v_oid) INTO v_definition;

  IF position(v_new in v_definition) > 0 THEN
    -- Idempotent replay: the strict ordering rule is already installed.
    RETURN;
  END IF;

  IF position(v_old in v_definition) = 0 THEN
    RAISE EXCEPTION 'unexpected_asset_position_ordering_definition';
  END IF;

  v_definition := replace(v_definition, v_old, v_new);
  EXECUTE v_definition;
END
$$;

COMMENT ON FUNCTION public.ingest_asset_position_legacy_impl(
  uuid,uuid,text,text,timestamptz,double precision,double precision,numeric,numeric,numeric,jsonb
) IS 'Internal server-only GPS ingest. Stores older OR equal-timestamp observations as historical so current asset location/geofence state advances only on a strictly newer recorded_at.';
