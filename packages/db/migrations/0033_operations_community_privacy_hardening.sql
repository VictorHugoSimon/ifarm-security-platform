-- SEC-199 hardening discovered during timing-observability RBAC validation.
-- Neighborhood administration is community scope only and must never imply access to private farms.

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
    JOIN public.app_users u ON u.id=m.user_id
    WHERE m.organization_id=p_organization_id
      AND m.status='active'
      AND u.status='active'
      AND u.auth_user_id=NULLIF(auth.user_id(),'')::uuid
      AND (
        m.role='admin_organization'
        OR (
          m.role='admin_neighborhood'
          AND p_property_id IS NULL
          AND p_neighborhood_id IS NOT NULL
          AND m.neighborhood_id=p_neighborhood_id
        )
        OR (
          m.role='monitoring'
          AND (m.neighborhood_id IS NULL OR m.neighborhood_id=p_neighborhood_id)
          AND (m.property_id IS NULL OR m.property_id=p_property_id)
        )
      )
  )
$$;

REVOKE ALL ON FUNCTION public.app_has_operations_access(uuid,uuid,uuid) FROM PUBLIC, anonymous;
GRANT EXECUTE ON FUNCTION public.app_has_operations_access(uuid,uuid,uuid) TO authenticated;

COMMENT ON FUNCTION public.app_has_operations_access(uuid,uuid,uuid) IS
'Operations access boundary. Admin organization may operate its organization; admin neighborhood is community-only and requires property_id IS NULL; monitoring follows explicit assigned scope. Never grants private farm visibility solely from neighborhood administration.';
