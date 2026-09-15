-- SEC-185 — Controlled Admin Bootstrap.
-- Platform admin authority lives in Neon Auth. Tenant invitations MUST NOT create admin_ifarm.
-- This migration hardens the database authority and adds an owner-only audit finalizer.

CREATE OR REPLACE FUNCTION public.app_is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, neon_auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM neon_auth."user" u
    WHERE u.id = NULLIF(auth.user_id(), '')::uuid
      AND u.role = 'admin_ifarm'
      AND COALESCE(u."emailVerified", false) = true
      AND COALESCE(u.banned, false) = false
  )
$$;

REVOKE ALL ON FUNCTION public.app_is_platform_admin() FROM PUBLIC, anonymous, authenticated;
GRANT EXECUTE ON FUNCTION public.app_is_platform_admin() TO authenticated;

COMMENT ON FUNCTION public.app_is_platform_admin() IS
'Authoritative platform-admin check. Requires Neon Auth role admin_ifarm, verified email, and non-banned identity.';

CREATE OR REPLACE FUNCTION public.app_finalize_first_platform_admin_bootstrap(
  p_auth_user_id uuid,
  p_expected_email text,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, neon_auth
AS $$
DECLARE
  v_email text;
  v_name text;
  v_verified boolean;
  v_role text;
  v_banned boolean;
  v_app_user_id uuid;
  v_admin_count integer;
BEGIN
  IF p_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'auth_user_id_required';
  END IF;

  IF p_expected_email IS NULL OR btrim(p_expected_email) = '' THEN
    RAISE EXCEPTION 'expected_email_required';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 OR length(p_reason) > 500 THEN
    RAISE EXCEPTION 'bootstrap_reason_invalid';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.audit_logs
    WHERE action = 'platform_admin.bootstrap.completed'
      AND entity_type = 'app_user'
  ) THEN
    RAISE EXCEPTION 'bootstrap_already_recorded';
  END IF;

  SELECT u.email, u.name, u."emailVerified", u.role, COALESCE(u.banned, false)
    INTO v_email, v_name, v_verified, v_role, v_banned
  FROM neon_auth."user" u
  WHERE u.id = p_auth_user_id;

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'auth_user_not_found';
  END IF;

  IF lower(v_email) <> lower(btrim(p_expected_email)) THEN
    RAISE EXCEPTION 'auth_user_email_mismatch';
  END IF;

  IF NOT COALESCE(v_verified, false) THEN
    RAISE EXCEPTION 'verified_email_required';
  END IF;

  IF v_role <> 'admin_ifarm' THEN
    RAISE EXCEPTION 'admin_ifarm_role_required';
  END IF;

  IF v_banned THEN
    RAISE EXCEPTION 'non_banned_identity_required';
  END IF;

  SELECT count(*)::integer INTO v_admin_count
  FROM neon_auth."user" u
  WHERE u.role = 'admin_ifarm'
    AND COALESCE(u."emailVerified", false) = true
    AND COALESCE(u.banned, false) = false;

  IF v_admin_count <> 1 THEN
    RAISE EXCEPTION 'first_admin_must_be_unique';
  END IF;

  INSERT INTO public.app_users(auth_user_id, external_auth_id, full_name, email, status, mfa_required)
  VALUES (
    p_auth_user_id,
    p_auth_user_id::text,
    COALESCE(NULLIF(btrim(v_name), ''), split_part(v_email, '@', 1)),
    lower(v_email),
    'active',
    true
  )
  ON CONFLICT (auth_user_id) DO UPDATE
    SET full_name = EXCLUDED.full_name,
        email = EXCLUDED.email,
        status = 'active',
        mfa_required = true
  RETURNING id INTO v_app_user_id;

  INSERT INTO public.audit_logs(
    organization_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    details
  ) VALUES (
    NULL,
    NULL,
    'platform_admin.bootstrap.completed',
    'app_user',
    v_app_user_id::text,
    jsonb_build_object(
      'auth_user_id', p_auth_user_id,
      'control_plane', 'neon_auth_operator',
      'reason', btrim(p_reason),
      'email_verified', true,
      'mfa_provider_support', 'pending'
    )
  );

  RETURN v_app_user_id;
END
$$;

REVOKE ALL ON FUNCTION public.app_finalize_first_platform_admin_bootstrap(uuid, text, text)
  FROM PUBLIC, anonymous, authenticated;

COMMENT ON FUNCTION public.app_finalize_first_platform_admin_bootstrap(uuid, text, text) IS
'Owner-only one-time finalizer. It does not grant admin_ifarm. The role must first be assigned through the official Neon Auth control plane to one verified, non-banned identity; this function creates/activates the app user and records the bootstrap audit event.';
