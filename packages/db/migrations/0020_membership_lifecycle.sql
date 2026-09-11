-- SEC-176 — ciclo de vida seguro de memberships ativos.
-- Aplicar DEV -> STAGE. PROD permanece fora desta fase.
-- Suspensão/revogação são por escopo e nunca permitem escalada de privilégio.

ALTER TABLE public.memberships
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS status_changed_by_user_id uuid REFERENCES public.app_users(id),
  ADD COLUMN IF NOT EXISTS status_reason text;

ALTER TABLE public.memberships
  DROP CONSTRAINT IF EXISTS memberships_status_allowed;

ALTER TABLE public.memberships
  ADD CONSTRAINT memberships_status_allowed CHECK (
    status IN ('active','suspended','revoked')
  );

ALTER TABLE public.memberships
  DROP CONSTRAINT IF EXISTS memberships_status_reason_length;

ALTER TABLE public.memberships
  ADD CONSTRAINT memberships_status_reason_length CHECK (
    status_reason IS NULL OR length(status_reason) <= 500
  );

CREATE OR REPLACE FUNCTION public.app_can_manage_membership(
  p_membership_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.memberships target
    WHERE target.id = p_membership_id
      AND target.role IN (
        'admin_organization',
        'admin_neighborhood',
        'owner',
        'family',
        'employee',
        'technician',
        'monitoring'
      )
      AND target.user_id IS DISTINCT FROM public.app_current_user_id()
      AND (
        public.app_is_platform_admin()
        OR (
          target.role <> 'admin_organization'
          AND EXISTS (
            SELECT 1
            FROM public.memberships actor_m
            JOIN public.app_users actor_u ON actor_u.id = actor_m.user_id
            WHERE actor_u.auth_user_id = NULLIF(auth.user_id(), '')::uuid
              AND actor_u.status = 'active'
              AND actor_m.status = 'active'
              AND actor_m.organization_id = target.organization_id
              AND actor_m.role = 'admin_organization'
          )
        )
        OR (
          target.property_id IS NULL
          AND target.neighborhood_id IS NOT NULL
          AND target.role IN ('technician','monitoring')
          AND EXISTS (
            SELECT 1
            FROM public.memberships actor_m
            JOIN public.app_users actor_u ON actor_u.id = actor_m.user_id
            WHERE actor_u.auth_user_id = NULLIF(auth.user_id(), '')::uuid
              AND actor_u.status = 'active'
              AND actor_m.status = 'active'
              AND actor_m.organization_id = target.organization_id
              AND actor_m.neighborhood_id = target.neighborhood_id
              AND actor_m.property_id IS NULL
              AND actor_m.role = 'admin_neighborhood'
          )
        )
        OR (
          target.property_id IS NOT NULL
          AND target.role IN ('family','employee','technician','monitoring')
          AND EXISTS (
            SELECT 1
            FROM public.memberships actor_m
            JOIN public.app_users actor_u ON actor_u.id = actor_m.user_id
            WHERE actor_u.auth_user_id = NULLIF(auth.user_id(), '')::uuid
              AND actor_u.status = 'active'
              AND actor_m.status = 'active'
              AND actor_m.organization_id = target.organization_id
              AND actor_m.property_id = target.property_id
              AND actor_m.role = 'owner'
          )
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.list_managed_memberships(
  p_organization_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  organization_id uuid,
  organization_name text,
  neighborhood_id uuid,
  neighborhood_name text,
  property_id uuid,
  property_name text,
  user_id uuid,
  full_name text,
  email text,
  role text,
  status text,
  created_at timestamptz,
  status_changed_at timestamptz,
  status_reason text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT
    m.id,
    m.organization_id,
    o.name AS organization_name,
    m.neighborhood_id,
    n.name AS neighborhood_name,
    m.property_id,
    p.name AS property_name,
    m.user_id,
    u.full_name,
    u.email,
    m.role,
    m.status,
    m.created_at,
    m.status_changed_at,
    m.status_reason
  FROM public.memberships m
  JOIN public.app_users u ON u.id = m.user_id
  JOIN public.organizations o ON o.id = m.organization_id
  LEFT JOIN public.neighborhoods n ON n.id = m.neighborhood_id
  LEFT JOIN public.properties p ON p.id = m.property_id
  WHERE (p_organization_id IS NULL OR m.organization_id = p_organization_id)
    AND public.app_can_manage_membership(m.id)
  ORDER BY o.name, COALESCE(p.name, n.name, ''), u.full_name, m.role
  LIMIT 500
$$;

CREATE OR REPLACE FUNCTION public.set_membership_status(
  p_membership_id uuid,
  p_status text,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_target public.memberships%ROWTYPE;
  v_actor uuid;
  v_status text := lower(trim(p_status));
  v_reason text := NULLIF(trim(p_reason), '');
  v_action text;
BEGIN
  SELECT * INTO v_target
  FROM public.memberships
  WHERE id = p_membership_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'membership_not_found';
  END IF;

  IF v_target.role IN ('admin_ifarm','authorized_authority','insurance_partner') THEN
    RAISE EXCEPTION 'membership_role_requires_separate_onboarding';
  END IF;

  IF v_status NOT IN ('active','suspended','revoked') THEN
    RAISE EXCEPTION 'membership_status_not_allowed';
  END IF;

  IF v_target.status = 'revoked' THEN
    RAISE EXCEPTION 'membership_revoked_terminal';
  END IF;

  IF v_target.status = v_status THEN
    RAISE EXCEPTION 'membership_status_unchanged';
  END IF;

  IF NOT public.app_can_manage_membership(p_membership_id) THEN
    RAISE EXCEPTION 'membership_management_not_allowed';
  END IF;

  IF v_status IN ('suspended','revoked') THEN
    IF v_reason IS NULL OR length(v_reason) < 3 OR length(v_reason) > 500 THEN
      RAISE EXCEPTION 'membership_reason_required';
    END IF;
  ELSIF v_reason IS NOT NULL AND length(v_reason) > 500 THEN
    RAISE EXCEPTION 'membership_reason_too_long';
  END IF;

  IF public.app_is_platform_admin() THEN
    v_actor := public.app_ensure_platform_user();
  ELSE
    v_actor := public.app_current_user_id();
  END IF;

  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'authentication_required';
  END IF;

  v_action := CASE v_status
    WHEN 'suspended' THEN 'access.membership.suspended'
    WHEN 'revoked' THEN 'access.membership.revoked'
    ELSE 'access.membership.reactivated'
  END;

  UPDATE public.memberships
     SET status = v_status,
         status_changed_at = now(),
         status_changed_by_user_id = v_actor,
         status_reason = v_reason
   WHERE id = p_membership_id;

  INSERT INTO public.audit_logs(
    organization_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    details
  )
  VALUES (
    v_target.organization_id,
    v_actor,
    v_action,
    'membership',
    v_target.id::text,
    jsonb_build_object(
      'target_user_id', v_target.user_id,
      'role', v_target.role,
      'neighborhood_id', v_target.neighborhood_id,
      'property_id', v_target.property_id,
      'from_status', v_target.status,
      'to_status', v_status,
      'reason', v_reason
    )
  );

  RETURN p_membership_id;
END
$$;

-- Memberships são dados de controle de acesso. O browser usa RPCs, nunca DML/leitura direta.
REVOKE ALL ON TABLE public.memberships FROM PUBLIC, anonymous, authenticated;

REVOKE ALL ON FUNCTION public.app_can_manage_membership(uuid)
  FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON FUNCTION public.list_managed_memberships(uuid)
  FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON FUNCTION public.set_membership_status(uuid,text,text)
  FROM PUBLIC, anonymous, authenticated;

GRANT EXECUTE ON FUNCTION public.list_managed_memberships(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_membership_status(uuid,text,text)
  TO authenticated;

COMMENT ON FUNCTION public.app_can_manage_membership(uuid)
  IS 'Internal scope/role gate for tenant membership lifecycle. Special institutional/platform roles remain outside generic management.';
COMMENT ON FUNCTION public.list_managed_memberships(uuid)
  IS 'Returns only memberships the current actor is authorized to manage. Direct browser access to memberships remains revoked.';
COMMENT ON FUNCTION public.set_membership_status(uuid,text,text)
  IS 'Suspends, reactivates or terminally revokes one manageable tenant membership with audit trail and reason validation.';
