-- SEC-010/011/012 — Organizações, bairros rurais e propriedades.
-- Aplicado primeiro no DEV. Operações de escrita expostas como RPCs controladas e auditadas.

CREATE OR REPLACE FUNCTION app_is_platform_admin()
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
      AND COALESCE(u.banned, false) = false
  )
$$;

CREATE OR REPLACE FUNCTION app_has_org_role(p_organization_id uuid, p_roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT app_is_platform_admin() OR EXISTS (
    SELECT 1
    FROM memberships m
    JOIN app_users u ON u.id = m.user_id
    WHERE u.auth_user_id = NULLIF(auth.user_id(), '')::uuid
      AND u.status = 'active'
      AND m.status = 'active'
      AND m.organization_id = p_organization_id
      AND m.role = ANY(p_roles)
  )
$$;

CREATE OR REPLACE FUNCTION app_has_org_membership(p_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT app_is_platform_admin() OR EXISTS (
    SELECT 1
    FROM memberships m
    JOIN app_users u ON u.id = m.user_id
    WHERE u.auth_user_id = NULLIF(auth.user_id(), '')::uuid
      AND u.status = 'active'
      AND m.status = 'active'
      AND m.organization_id = p_organization_id
  )
$$;

CREATE OR REPLACE FUNCTION app_has_scope_access(p_organization_id uuid, p_neighborhood_id uuid, p_property_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT app_is_platform_admin() OR EXISTS (
    SELECT 1
    FROM memberships m
    JOIN app_users u ON u.id = m.user_id
    WHERE u.auth_user_id = NULLIF(auth.user_id(), '')::uuid
      AND u.status = 'active'
      AND m.status = 'active'
      AND m.organization_id = p_organization_id
      AND (
        m.role = 'admin_organization'
        OR (p_property_id IS NOT NULL AND m.property_id = p_property_id)
        OR (p_property_id IS NULL AND p_neighborhood_id IS NOT NULL AND m.neighborhood_id = p_neighborhood_id)
      )
  )
$$;

CREATE OR REPLACE FUNCTION app_ensure_platform_user()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, neon_auth
AS $$
DECLARE
  v_auth_user uuid := NULLIF(auth.user_id(), '')::uuid;
  v_email text;
  v_name text;
  v_verified boolean;
  v_app_user uuid;
BEGIN
  IF NOT app_is_platform_admin() THEN
    RAISE EXCEPTION 'platform_admin_required';
  END IF;

  SELECT email, name, "emailVerified"
  INTO v_email, v_name, v_verified
  FROM neon_auth."user"
  WHERE id = v_auth_user;

  IF NOT COALESCE(v_verified, false) THEN
    RAISE EXCEPTION 'verified_email_required';
  END IF;

  INSERT INTO app_users(auth_user_id, external_auth_id, full_name, email, status, mfa_required)
  VALUES (v_auth_user, v_auth_user::text, v_name, lower(v_email), 'active', true)
  ON CONFLICT (auth_user_id) DO UPDATE
    SET full_name = EXCLUDED.full_name,
        email = EXCLUDED.email,
        status = 'active'
  RETURNING id INTO v_app_user;

  RETURN v_app_user;
END
$$;

CREATE OR REPLACE FUNCTION create_organization(p_name text, p_legal_name text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org uuid;
  v_user uuid;
BEGIN
  IF NULLIF(trim(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'organization_name_required';
  END IF;

  IF NOT app_is_platform_admin() THEN
    RAISE EXCEPTION 'platform_admin_required';
  END IF;

  v_user := app_ensure_platform_user();

  INSERT INTO organizations(name, legal_name)
  VALUES (trim(p_name), NULLIF(trim(p_legal_name), ''))
  RETURNING id INTO v_org;

  INSERT INTO memberships(organization_id, user_id, role, status)
  VALUES (v_org, v_user, 'admin_ifarm', 'active');

  INSERT INTO audit_logs(organization_id, actor_user_id, action, entity_type, entity_id, details)
  VALUES (v_org, v_user, 'organization.created', 'organization', v_org::text, jsonb_build_object('name', trim(p_name)));

  RETURN v_org;
END
$$;

CREATE OR REPLACE FUNCTION create_neighborhood(p_organization_id uuid, p_name text, p_municipality text DEFAULT NULL, p_state_code text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_id uuid;
  v_user uuid := app_current_user_id();
BEGIN
  IF NULLIF(trim(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'neighborhood_name_required';
  END IF;

  IF p_state_code IS NOT NULL AND length(trim(p_state_code)) NOT IN (0,2) THEN
    RAISE EXCEPTION 'invalid_state_code';
  END IF;

  IF NOT app_has_org_role(p_organization_id, ARRAY['admin_ifarm','admin_organization']) THEN
    RAISE EXCEPTION 'organization_admin_required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = p_organization_id AND status = 'active') THEN
    RAISE EXCEPTION 'organization_not_found';
  END IF;

  INSERT INTO neighborhoods(organization_id, name, municipality, state_code)
  VALUES (p_organization_id, trim(p_name), NULLIF(trim(p_municipality), ''), NULLIF(upper(trim(p_state_code)), '')::char(2))
  RETURNING id INTO v_id;

  INSERT INTO audit_logs(organization_id, actor_user_id, action, entity_type, entity_id, details)
  VALUES (p_organization_id, v_user, 'neighborhood.created', 'neighborhood', v_id::text, jsonb_build_object('name', trim(p_name)));

  RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION create_property(p_organization_id uuid, p_neighborhood_id uuid, p_name text, p_municipality text DEFAULT NULL, p_state_code text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_id uuid;
  v_user uuid := app_current_user_id();
BEGIN
  IF NULLIF(trim(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'property_name_required';
  END IF;

  IF p_state_code IS NOT NULL AND length(trim(p_state_code)) NOT IN (0,2) THEN
    RAISE EXCEPTION 'invalid_state_code';
  END IF;

  IF NOT app_has_org_role(p_organization_id, ARRAY['admin_ifarm','admin_organization']) THEN
    RAISE EXCEPTION 'organization_admin_required';
  END IF;

  IF p_neighborhood_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM neighborhoods
    WHERE id = p_neighborhood_id AND organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'neighborhood_scope_mismatch';
  END IF;

  INSERT INTO properties(organization_id, neighborhood_id, name, municipality, state_code)
  VALUES (p_organization_id, p_neighborhood_id, trim(p_name), NULLIF(trim(p_municipality), ''), NULLIF(upper(trim(p_state_code)), '')::char(2))
  RETURNING id INTO v_id;

  INSERT INTO audit_logs(organization_id, actor_user_id, action, entity_type, entity_id, details)
  VALUES (p_organization_id, v_user, 'property.created', 'property', v_id::text, jsonb_build_object('name', trim(p_name), 'neighborhood_id', p_neighborhood_id));

  RETURN v_id;
END
$$;
