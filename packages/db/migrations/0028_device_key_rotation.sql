-- SEC-192 — ciclo de vida e rotação controlada de credenciais de ingestão.
-- A chave bruta continua sendo gerada fora do banco. O banco recebe somente SHA-256.
-- A rotação mantém a chave predecessora válida por uma janela curta via expires_at,
-- reaproveitando as validações já existentes nas RPCs de ingestão.

ALTER TABLE public.device_ingest_keys
  ADD COLUMN IF NOT EXISTS rotated_from_key_id uuid REFERENCES public.device_ingest_keys(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_device_ingest_keys_single_rotation_child
  ON public.device_ingest_keys(rotated_from_key_id)
  WHERE rotated_from_key_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.rotate_device_ingest_key(
  p_device_id uuid,
  p_predecessor_key_id uuid,
  p_new_key_hash text,
  p_label text DEFAULT NULL,
  p_new_expires_at timestamptz DEFAULT NULL,
  p_overlap_minutes integer DEFAULT 60
)
RETURNS TABLE(
  new_key_id uuid,
  predecessor_key_id uuid,
  predecessor_valid_until timestamptz,
  new_key_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org uuid;
  v_old_expires_at timestamptz;
  v_overlap_until timestamptz;
  v_new_expires_at timestamptz := COALESCE(p_new_expires_at, now() + interval '90 days');
  v_label text := nullif(trim(p_label), '');
  v_new_id uuid;
  v_active_count integer;
BEGIN
  IF p_new_key_hash IS NULL OR p_new_key_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_key_hash';
  END IF;
  IF v_label IS NOT NULL AND length(v_label) > 80 THEN
    RAISE EXCEPTION 'key_label_too_long';
  END IF;
  IF p_overlap_minutes IS NULL OR p_overlap_minutes < 5 OR p_overlap_minutes > 1440 THEN
    RAISE EXCEPTION 'invalid_rotation_overlap';
  END IF;
  IF v_new_expires_at <= now() OR v_new_expires_at > now() + interval '365 days' THEN
    RAISE EXCEPTION 'invalid_expiration';
  END IF;

  SELECT d.organization_id
    INTO v_org
    FROM public.devices d
   WHERE d.id = p_device_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'device_not_found';
  END IF;
  IF NOT public.app_can_manage_device(p_device_id) THEN
    RAISE EXCEPTION 'device_management_required';
  END IF;

  SELECT k.expires_at
    INTO v_old_expires_at
    FROM public.device_ingest_keys k
   WHERE k.id = p_predecessor_key_id
     AND k.device_id = p_device_id
     AND k.organization_id = v_org
     AND k.status = 'active'
     AND k.expires_at > now()
   FOR UPDATE;
  IF v_old_expires_at IS NULL THEN
    RAISE EXCEPTION 'active_predecessor_key_required';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.device_ingest_keys k
     WHERE k.rotated_from_key_id = p_predecessor_key_id
  ) THEN
    RAISE EXCEPTION 'predecessor_already_rotated';
  END IF;

  SELECT count(*)
    INTO v_active_count
    FROM public.device_ingest_keys k
   WHERE k.device_id = p_device_id
     AND k.status = 'active'
     AND k.expires_at > now();
  IF v_active_count >= 5 THEN
    RAISE EXCEPTION 'active_key_limit_reached';
  END IF;

  v_overlap_until := LEAST(v_old_expires_at, now() + make_interval(mins => p_overlap_minutes));

  INSERT INTO public.device_ingest_keys(
    organization_id,
    device_id,
    key_hash,
    label,
    expires_at,
    rotated_from_key_id
  ) VALUES (
    v_org,
    p_device_id,
    lower(p_new_key_hash),
    v_label,
    v_new_expires_at,
    p_predecessor_key_id
  )
  RETURNING id INTO v_new_id;

  UPDATE public.device_ingest_keys
     SET expires_at = v_overlap_until
   WHERE id = p_predecessor_key_id;

  INSERT INTO public.audit_logs(
    organization_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    details
  ) VALUES (
    v_org,
    public.app_current_user_id(),
    'device.ingest_key.rotation_started',
    'device',
    p_device_id::text,
    jsonb_build_object(
      'predecessor_key_id', p_predecessor_key_id,
      'new_key_id', v_new_id,
      'predecessor_valid_until', v_overlap_until,
      'new_key_expires_at', v_new_expires_at,
      'overlap_minutes', p_overlap_minutes,
      'raw_key_stored', false
    )
  );

  RETURN QUERY SELECT v_new_id, p_predecessor_key_id, v_overlap_until, v_new_expires_at;
END
$$;

-- Keep the original RPC return signature for backward compatibility. Rotation state
-- is exposed through the existing status field instead of adding a new result column.
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
      WHEN k.status = 'revoked' THEN 'revoked'
      WHEN k.expires_at <= now() THEN 'expired'
      WHEN EXISTS (
        SELECT 1
          FROM public.device_ingest_keys child
         WHERE child.rotated_from_key_id = k.id
      ) THEN 'retiring'
      ELSE 'active'
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

CREATE OR REPLACE FUNCTION public.revoke_device_ingest_key(p_key_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_device uuid;
  v_org uuid;
  v_status text;
BEGIN
  SELECT device_id, organization_id, status
    INTO v_device, v_org, v_status
    FROM public.device_ingest_keys
   WHERE id = p_key_id
   FOR UPDATE;

  IF v_device IS NULL THEN
    RAISE EXCEPTION 'key_not_found';
  END IF;
  IF NOT public.app_can_manage_device(v_device) THEN
    RAISE EXCEPTION 'device_management_required';
  END IF;
  IF v_status <> 'active' THEN
    RAISE EXCEPTION 'key_not_active';
  END IF;

  UPDATE public.device_ingest_keys
     SET status = 'revoked', revoked_at = now()
   WHERE id = p_key_id;

  INSERT INTO public.audit_logs(organization_id, actor_user_id, action, entity_type, entity_id, details)
  VALUES(
    v_org,
    public.app_current_user_id(),
    'device.ingest_key.revoked',
    'device',
    v_device::text,
    jsonb_build_object('key_id', p_key_id)
  );

  RETURN p_key_id;
END
$$;

REVOKE ALL ON FUNCTION public.rotate_device_ingest_key(uuid, uuid, text, text, timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rotate_device_ingest_key(uuid, uuid, text, text, timestamptz, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.list_device_ingest_keys(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_device_ingest_keys(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.revoke_device_ingest_key(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_device_ingest_key(uuid) TO authenticated;

COMMENT ON FUNCTION public.rotate_device_ingest_key(uuid, uuid, text, text, timestamptz, integer)
IS 'Starts a controlled device-key rotation. The raw key is generated client-side and never stored; the predecessor remains valid only for a bounded overlap window.';
