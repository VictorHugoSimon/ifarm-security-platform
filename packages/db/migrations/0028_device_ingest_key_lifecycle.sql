-- SEC-191 — Device Ingest Key Lifecycle.
-- Raw device keys are generated client-side with Web Crypto and are never stored.
-- The database receives only SHA-256 and now requires bounded expiration.

ALTER TABLE public.device_ingest_keys
  ALTER COLUMN expires_at SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE public.device_ingest_keys
    ADD CONSTRAINT device_ingest_keys_hash_format
    CHECK (key_hash ~ '^[0-9a-f]{64}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.device_ingest_keys
    ADD CONSTRAINT device_ingest_keys_label_length
    CHECK (label IS NULL OR length(label) <= 80);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.device_ingest_keys
    ADD CONSTRAINT device_ingest_keys_expiration_window
    CHECK (expires_at > created_at AND expires_at <= created_at + interval '366 days');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.register_device_ingest_key(
  p_device_id uuid,
  p_key_hash text,
  p_label text DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org uuid;
  v_id uuid;
  v_active_count integer;
  v_expires_at timestamptz := COALESCE(p_expires_at, now() + interval '90 days');
  v_label text := nullif(trim(p_label), '');
BEGIN
  IF p_key_hash IS NULL OR p_key_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_key_hash';
  END IF;

  IF v_label IS NOT NULL AND length(v_label) > 80 THEN
    RAISE EXCEPTION 'key_label_too_long';
  END IF;

  SELECT organization_id INTO v_org
  FROM public.devices
  WHERE id = p_device_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'device_not_found';
  END IF;

  IF NOT public.app_can_manage_device(p_device_id) THEN
    RAISE EXCEPTION 'device_management_required';
  END IF;

  IF v_expires_at <= now() OR v_expires_at > now() + interval '365 days' THEN
    RAISE EXCEPTION 'invalid_expiration';
  END IF;

  SELECT count(*) INTO v_active_count
  FROM public.device_ingest_keys
  WHERE device_id = p_device_id
    AND status = 'active'
    AND expires_at > now();

  IF v_active_count >= 5 THEN
    RAISE EXCEPTION 'active_key_limit_reached';
  END IF;

  INSERT INTO public.device_ingest_keys(
    organization_id, device_id, key_hash, label, expires_at
  ) VALUES (
    v_org, p_device_id, lower(p_key_hash), v_label, v_expires_at
  )
  RETURNING id INTO v_id;

  INSERT INTO public.audit_logs(
    organization_id, actor_user_id, action, entity_type, entity_id, details
  ) VALUES (
    v_org,
    public.app_current_user_id(),
    'device.ingest_key.created',
    'device',
    p_device_id::text,
    jsonb_build_object(
      'key_id', v_id,
      'label', v_label,
      'expires_at', v_expires_at,
      'raw_key_stored', false
    )
  );

  RETURN v_id;
END
$$;

REVOKE ALL ON FUNCTION public.register_device_ingest_key(uuid, text, text, timestamptz)
  FROM PUBLIC, anonymous, authenticated;
GRANT EXECUTE ON FUNCTION public.register_device_ingest_key(uuid, text, text, timestamptz)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.list_device_ingest_keys(p_device_id uuid)
RETURNS TABLE(
  id uuid,
  label text,
  status text,
  expires_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz,
  revoked_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NOT public.app_can_manage_device(p_device_id) THEN
    RAISE EXCEPTION 'device_management_required';
  END IF;

  RETURN QUERY
  SELECT
    k.id,
    k.label,
    CASE
      WHEN k.status = 'active' AND k.expires_at <= now() THEN 'expired'
      ELSE k.status
    END,
    k.expires_at,
    k.last_used_at,
    k.created_at,
    k.revoked_at
  FROM public.device_ingest_keys k
  WHERE k.device_id = p_device_id
  ORDER BY k.created_at DESC;
END
$$;

REVOKE ALL ON FUNCTION public.list_device_ingest_keys(uuid)
  FROM PUBLIC, anonymous, authenticated;
GRANT EXECUTE ON FUNCTION public.list_device_ingest_keys(uuid)
  TO authenticated;

COMMENT ON FUNCTION public.register_device_ingest_key(uuid, text, text, timestamptz) IS
'Registers only a SHA-256 device-key hash. Expiration defaults to 90 days and cannot exceed 365 days. Raw keys must never be sent to this function.';

COMMENT ON FUNCTION public.list_device_ingest_keys(uuid) IS
'Lists device ingest key metadata only. Raw key/hash are never returned; elapsed active keys are surfaced as effective status expired.';
