-- SEC-177 — trilha sanitizada de auditoria de acessos.
-- Aplicar DEV -> STAGE. PROD permanece fora desta fase.
-- audit_logs nunca é lida diretamente pelo browser.

CREATE OR REPLACE FUNCTION public.app_can_view_access_audit(
  p_organization_id uuid,
  p_neighborhood_id uuid,
  p_property_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT
    public.app_is_platform_admin()
    OR EXISTS (
      SELECT 1
      FROM public.memberships m
      JOIN public.app_users u ON u.id = m.user_id
      WHERE u.auth_user_id = NULLIF(auth.user_id(), '')::uuid
        AND u.status = 'active'
        AND m.status = 'active'
        AND m.organization_id = p_organization_id
        AND m.role = 'admin_organization'
    )
    OR (
      p_property_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.memberships m
        JOIN public.app_users u ON u.id = m.user_id
        WHERE u.auth_user_id = NULLIF(auth.user_id(), '')::uuid
          AND u.status = 'active'
          AND m.status = 'active'
          AND m.organization_id = p_organization_id
          AND m.property_id = p_property_id
          AND m.role = 'owner'
      )
    )
    OR (
      p_property_id IS NULL
      AND p_neighborhood_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.memberships m
        JOIN public.app_users u ON u.id = m.user_id
        WHERE u.auth_user_id = NULLIF(auth.user_id(), '')::uuid
          AND u.status = 'active'
          AND m.status = 'active'
          AND m.organization_id = p_organization_id
          AND m.neighborhood_id = p_neighborhood_id
          AND m.property_id IS NULL
          AND m.role = 'admin_neighborhood'
      )
    )
$$;

CREATE OR REPLACE FUNCTION public.audit_access_invitation_accepted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_actor uuid;
BEGIN
  IF OLD.status = 'pending' AND NEW.status = 'accepted' THEN
    v_actor := public.app_current_user_id();

    INSERT INTO public.audit_logs(
      organization_id,
      actor_user_id,
      action,
      entity_type,
      entity_id,
      details
    ) VALUES (
      NEW.organization_id,
      v_actor,
      'access.invitation.accepted',
      'access_invitation',
      NEW.id::text,
      jsonb_build_object(
        'role', NEW.role,
        'neighborhood_id', NEW.neighborhood_id,
        'property_id', NEW.property_id
      )
    );
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_access_invitation_accepted_audit
  ON public.access_invitations;

CREATE TRIGGER trg_access_invitation_accepted_audit
AFTER UPDATE OF status ON public.access_invitations
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.audit_access_invitation_accepted();

CREATE OR REPLACE FUNCTION public.list_access_audit_events(
  p_organization_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  id bigint,
  organization_id uuid,
  organization_name text,
  neighborhood_id uuid,
  neighborhood_name text,
  property_id uuid,
  property_name text,
  actor_name text,
  action text,
  entity_type text,
  entity_id text,
  target_role text,
  from_status text,
  to_status text,
  reason text,
  occurred_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  WITH access_events AS (
    SELECT
      a.*,
      CASE
        WHEN COALESCE(a.details->>'neighborhood_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          THEN (a.details->>'neighborhood_id')::uuid
        ELSE NULL
      END AS scope_neighborhood_id,
      CASE
        WHEN COALESCE(a.details->>'property_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          THEN (a.details->>'property_id')::uuid
        ELSE NULL
      END AS scope_property_id
    FROM public.audit_logs a
    WHERE a.action IN (
      'access.invitation.created',
      'access.invitation.revoked',
      'access.invitation.accepted',
      'access.membership.suspended',
      'access.membership.reactivated',
      'access.membership.revoked'
    )
  )
  SELECT
    e.id,
    e.organization_id,
    o.name AS organization_name,
    e.scope_neighborhood_id AS neighborhood_id,
    n.name AS neighborhood_name,
    e.scope_property_id AS property_id,
    p.name AS property_name,
    actor.full_name AS actor_name,
    e.action,
    e.entity_type,
    e.entity_id,
    NULLIF(e.details->>'role', '') AS target_role,
    NULLIF(e.details->>'from_status', '') AS from_status,
    NULLIF(e.details->>'to_status', '') AS to_status,
    NULLIF(e.details->>'reason', '') AS reason,
    e.occurred_at
  FROM access_events e
  LEFT JOIN public.organizations o ON o.id = e.organization_id
  LEFT JOIN public.neighborhoods n ON n.id = e.scope_neighborhood_id
  LEFT JOIN public.properties p ON p.id = e.scope_property_id
  LEFT JOIN public.app_users actor ON actor.id = e.actor_user_id
  WHERE e.organization_id IS NOT NULL
    AND (p_organization_id IS NULL OR e.organization_id = p_organization_id)
    AND public.app_can_view_access_audit(
      e.organization_id,
      e.scope_neighborhood_id,
      e.scope_property_id
    )
  ORDER BY e.occurred_at DESC, e.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500)
$$;

-- Audit log contém metadados sensíveis. Browser só usa a RPC sanitizada.
REVOKE ALL ON TABLE public.audit_logs FROM PUBLIC, anonymous, authenticated;

REVOKE ALL ON FUNCTION public.app_can_view_access_audit(uuid,uuid,uuid)
  FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON FUNCTION public.audit_access_invitation_accepted()
  FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON FUNCTION public.list_access_audit_events(uuid,integer)
  FROM PUBLIC, anonymous, authenticated;

GRANT EXECUTE ON FUNCTION public.list_access_audit_events(uuid,integer)
  TO authenticated;

COMMENT ON FUNCTION public.app_can_view_access_audit(uuid,uuid,uuid)
  IS 'Internal scope gate for sanitized access audit. Admin Neighborhood is community-only; Owner is property-only.';
COMMENT ON FUNCTION public.list_access_audit_events(uuid,integer)
  IS 'Returns sanitized access-management audit events without raw details, email/hash, IP or request metadata.';
