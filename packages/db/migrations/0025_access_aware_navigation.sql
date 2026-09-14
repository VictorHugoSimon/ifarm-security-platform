-- SEC-182 — Access-Aware Navigation.
-- UX/least-surface only. RLS/RPC authorization remains the security authority.
-- The RPC returns module keys only; it does not expose roles, tenant IDs or membership details.

CREATE OR REPLACE FUNCTION public.get_my_navigation_modules()
RETURNS TABLE(module_key text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  WITH me AS (
    SELECT public.app_current_user_id() AS user_id,
           public.app_is_platform_admin() AS is_platform_admin
  ), active_memberships AS (
    SELECT m.role,m.neighborhood_id,m.property_id
    FROM public.memberships m
    JOIN public.app_users u ON u.id=m.user_id
    CROSS JOIN me
    WHERE me.user_id IS NOT NULL
      AND m.user_id=me.user_id
      AND m.status='active'
      AND u.status='active'
  ), flags AS (
    SELECT
      me.user_id IS NOT NULL AS authenticated_app_user,
      me.is_platform_admin,
      EXISTS(SELECT 1 FROM active_memberships) AS has_membership,
      EXISTS(SELECT 1 FROM active_memberships WHERE role='admin_organization') AS admin_org,
      EXISTS(SELECT 1 FROM active_memberships WHERE role='admin_neighborhood') AS admin_neighborhood,
      EXISTS(SELECT 1 FROM active_memberships WHERE role='owner') AS owner_role,
      EXISTS(SELECT 1 FROM active_memberships WHERE role='family') AS family_role,
      EXISTS(SELECT 1 FROM active_memberships WHERE role='employee') AS employee_role,
      EXISTS(SELECT 1 FROM active_memberships WHERE role='technician') AS technician_role,
      EXISTS(SELECT 1 FROM active_memberships WHERE role='monitoring') AS monitoring_role,
      EXISTS(SELECT 1 FROM active_memberships WHERE neighborhood_id IS NOT NULL) AS neighborhood_scope,
      EXISTS(SELECT 1 FROM active_memberships WHERE role='monitoring' AND neighborhood_id IS NOT NULL AND property_id IS NULL) AS neighborhood_monitoring,
      EXISTS(SELECT 1 FROM active_memberships WHERE property_id IS NOT NULL) AS property_scope
    FROM me
  ), modules(module_key,allowed) AS (
    SELECT 'overview', authenticated_app_user OR is_platform_admin FROM flags
    UNION ALL SELECT 'operations', is_platform_admin OR admin_org OR admin_neighborhood OR monitoring_role FROM flags
    UNION ALL SELECT 'pilot', is_platform_admin OR admin_org OR admin_neighborhood OR neighborhood_monitoring OR owner_role FROM flags
    UNION ALL SELECT 'sos', is_platform_admin OR has_membership FROM flags
    UNION ALL SELECT 'assets', is_platform_admin OR admin_org OR owner_role OR family_role OR employee_role OR technician_role OR monitoring_role FROM flags
    UNION ALL SELECT 'insurance', is_platform_admin OR admin_org OR owner_role FROM flags
    UNION ALL SELECT 'community', is_platform_admin OR admin_org OR neighborhood_scope FROM flags
    UNION ALL SELECT 'rural', is_platform_admin OR admin_org OR admin_neighborhood OR owner_role OR technician_role FROM flags
    UNION ALL SELECT 'devices', is_platform_admin OR admin_org OR admin_neighborhood OR owner_role OR technician_role OR monitoring_role FROM flags
    UNION ALL SELECT 'support', is_platform_admin OR has_membership FROM flags
    UNION ALL SELECT 'privacy', is_platform_admin OR has_membership FROM flags
    UNION ALL SELECT 'access', is_platform_admin OR admin_org OR admin_neighborhood OR owner_role FROM flags
    UNION ALL SELECT 'audit', is_platform_admin OR admin_org OR admin_neighborhood OR owner_role FROM flags
    UNION ALL SELECT 'health', is_platform_admin OR admin_org OR admin_neighborhood OR owner_role OR technician_role OR monitoring_role FROM flags
    UNION ALL SELECT 'events', is_platform_admin OR has_membership FROM flags
    UNION ALL SELECT 'incidents', is_platform_admin OR has_membership FROM flags
    UNION ALL SELECT 'evidence', is_platform_admin OR admin_org OR admin_neighborhood OR owner_role OR monitoring_role FROM flags
    UNION ALL SELECT 'map', is_platform_admin OR has_membership FROM flags
  )
  SELECT module_key FROM modules WHERE allowed ORDER BY module_key
$$;

REVOKE ALL ON FUNCTION public.get_my_navigation_modules() FROM PUBLIC, anonymous, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_navigation_modules() TO authenticated;

COMMENT ON FUNCTION public.get_my_navigation_modules() IS
'UX least-surface helper. Returns only module keys derived from active access. It does not grant authorization; every underlying table/RPC remains protected independently by RLS and server-side checks.';
