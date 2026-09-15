-- SEC-186 — Platform Admin Lifecycle & Recovery.
-- Platform-admin role changes happen only in the official Neon Auth control plane.
-- Database functions below are owner-only guardrails/audit finalizers; they never grant or revoke auth roles.

CREATE OR REPLACE FUNCTION public.app_platform_admin_revoke_preflight(
  p_target_auth_user_id uuid,
  p_expected_email text
)
RETURNS TABLE (
  target_is_eligible boolean,
  eligible_other_admin_count integer,
  can_revoke boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, neon_auth
AS $$
DECLARE
  v_email text;
  v_role text;
  v_verified boolean;
  v_banned boolean;
  v_other_count integer;
BEGIN
  IF p_target_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'auth_user_id_required';
  END IF;

  IF p_expected_email IS NULL OR btrim(p_expected_email) = '' THEN
    RAISE EXCEPTION 'expected_email_required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.audit_logs
    WHERE action = 'platform_admin.bootstrap.completed'
      AND entity_type = 'app_user'
  ) THEN
    RAISE EXCEPTION 'platform_admin_bootstrap_required';
  END IF;

  SELECT u.email, u.role, COALESCE(u."emailVerified", false), COALESCE(u.banned, false)
    INTO v_email, v_role, v_verified, v_banned
  FROM neon_auth."user" u
  WHERE u.id = p_target_auth_user_id;

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'auth_user_not_found';
  END IF;

  IF lower(v_email) <> lower(btrim(p_expected_email)) THEN
    RAISE EXCEPTION 'auth_user_email_mismatch';
  END IF;

  IF NOT (v_role = 'admin_ifarm' AND v_verified AND NOT v_banned) THEN
    RAISE EXCEPTION 'target_not_active_platform_admin';
  END IF;

  SELECT count(*)::integer INTO v_other_count
  FROM neon_auth."user" u
  WHERE u.id <> p_target_auth_user_id
    AND u.role = 'admin_ifarm'
    AND COALESCE(u."emailVerified", false) = true
    AND COALESCE(u.banned, false) = false;

  IF v_other_count < 1 THEN
    RAISE EXCEPTION 'last_platform_admin_revoke_forbidden';
  END IF;

  RETURN QUERY SELECT true, v_other_count, true;
END
$$;

REVOKE ALL ON FUNCTION public.app_platform_admin_revoke_preflight(uuid, text)
  FROM PUBLIC, anonymous, authenticated;

COMMENT ON FUNCTION public.app_platform_admin_revoke_preflight(uuid, text) IS
'Owner-only preflight executed before changing a platform-admin role in Neon Auth. Refuses revocation when no other verified, non-banned admin_ifarm identity exists.';

CREATE OR REPLACE FUNCTION public.app_finalize_platform_admin_change(
  p_action text,
  p_target_auth_user_id uuid,
  p_expected_email text,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, neon_auth
AS $$
DECLARE
  v_action text := lower(btrim(COALESCE(p_action, '')));
  v_email text;
  v_name text;
  v_role text;
  v_verified boolean;
  v_banned boolean;
  v_is_eligible boolean;
  v_eligible_count integer;
  v_app_user_id uuid;
  v_latest_action text;
BEGIN
  IF v_action NOT IN ('promote', 'revoke') THEN
    RAISE EXCEPTION 'platform_admin_action_invalid';
  END IF;

  IF p_target_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'auth_user_id_required';
  END IF;

  IF p_expected_email IS NULL OR btrim(p_expected_email) = '' THEN
    RAISE EXCEPTION 'expected_email_required';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 OR length(p_reason) > 500 THEN
    RAISE EXCEPTION 'platform_admin_reason_invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.audit_logs
    WHERE action = 'platform_admin.bootstrap.completed'
      AND entity_type = 'app_user'
  ) THEN
    RAISE EXCEPTION 'platform_admin_bootstrap_required';
  END IF;

  SELECT u.email,
         u.name,
         u.role,
         COALESCE(u."emailVerified", false),
         COALESCE(u.banned, false)
    INTO v_email, v_name, v_role, v_verified, v_banned
  FROM neon_auth."user" u
  WHERE u.id = p_target_auth_user_id;

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'auth_user_not_found';
  END IF;

  IF lower(v_email) <> lower(btrim(p_expected_email)) THEN
    RAISE EXCEPTION 'auth_user_email_mismatch';
  END IF;

  v_is_eligible := (v_role = 'admin_ifarm' AND v_verified AND NOT v_banned);

  SELECT count(*)::integer INTO v_eligible_count
  FROM neon_auth."user" u
  WHERE u.role = 'admin_ifarm'
    AND COALESCE(u."emailVerified", false) = true
    AND COALESCE(u.banned, false) = false;

  SELECT a.action INTO v_latest_action
  FROM public.audit_logs a
  WHERE a.action IN (
      'platform_admin.bootstrap.completed',
      'platform_admin.promoted',
      'platform_admin.revoked'
    )
    AND a.details ->> 'auth_user_id' = p_target_auth_user_id::text
  ORDER BY a.occurred_at DESC, a.id DESC
  LIMIT 1;

  IF v_action = 'promote' THEN
    IF NOT v_is_eligible THEN
      RAISE EXCEPTION 'promoted_identity_not_eligible';
    END IF;

    -- The first administrator is handled only by SEC-185 bootstrap.
    -- Every later promotion must leave at least two eligible platform admins.
    IF v_eligible_count < 2 THEN
      RAISE EXCEPTION 'additional_admin_requires_existing_admin';
    END IF;

    IF v_latest_action IN ('platform_admin.bootstrap.completed', 'platform_admin.promoted') THEN
      RAISE EXCEPTION 'platform_admin_already_active';
    END IF;

    INSERT INTO public.app_users(auth_user_id, external_auth_id, full_name, email, status, mfa_required)
    VALUES (
      p_target_auth_user_id,
      p_target_auth_user_id::text,
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
      organization_id, actor_user_id, action, entity_type, entity_id, details
    ) VALUES (
      NULL,
      NULL,
      'platform_admin.promoted',
      'app_user',
      v_app_user_id::text,
      jsonb_build_object(
        'auth_user_id', p_target_auth_user_id,
        'control_plane', 'neon_auth_operator',
        'reason', btrim(p_reason),
        'eligible_admin_count_after', v_eligible_count,
        'email_verified', v_verified,
        'banned', v_banned,
        'mfa_provider_support', 'pending'
      )
    );

    RETURN v_app_user_id;
  END IF;

  -- revoke: the external control plane must already have removed eligibility.
  IF v_is_eligible THEN
    RAISE EXCEPTION 'role_revocation_not_applied';
  END IF;

  IF v_eligible_count < 1 THEN
    RAISE EXCEPTION 'last_platform_admin_revoke_forbidden';
  END IF;

  IF v_latest_action NOT IN ('platform_admin.bootstrap.completed', 'platform_admin.promoted') THEN
    RAISE EXCEPTION 'platform_admin_not_active_in_audit_state';
  END IF;

  SELECT u.id INTO v_app_user_id
  FROM public.app_users u
  WHERE u.auth_user_id = p_target_auth_user_id;

  IF v_app_user_id IS NULL THEN
    RAISE EXCEPTION 'app_user_not_found';
  END IF;

  INSERT INTO public.audit_logs(
    organization_id, actor_user_id, action, entity_type, entity_id, details
  ) VALUES (
    NULL,
    NULL,
    'platform_admin.revoked',
    'app_user',
    v_app_user_id::text,
    jsonb_build_object(
      'auth_user_id', p_target_auth_user_id,
      'control_plane', 'neon_auth_operator',
      'reason', btrim(p_reason),
      'eligible_admin_count_after', v_eligible_count,
      'role_after', v_role,
      'email_verified_after', v_verified,
      'banned_after', v_banned,
      'mfa_provider_support', 'pending'
    )
  );

  RETURN v_app_user_id;
END
$$;

REVOKE ALL ON FUNCTION public.app_finalize_platform_admin_change(text, uuid, text, text)
  FROM PUBLIC, anonymous, authenticated;

COMMENT ON FUNCTION public.app_finalize_platform_admin_change(text, uuid, text, text) IS
'Owner-only post-change validator/audit finalizer for additional platform-admin promotions and revocations. It never mutates Neon Auth roles and refuses any resulting state with zero eligible platform admins.';
