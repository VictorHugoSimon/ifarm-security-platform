-- SEC-185 — Controlled Admin Bootstrap.
-- Platform admin authority lives in Neon Auth. Tenant invitations MUST NOT create admin_ifarm.
-- No browser/admin-bootstrap RPC is created here: role assignment stays in the official Neon Auth control plane.

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

-- Existing app_ensure_platform_user() remains the only materialization path for a platform admin.
-- It already requires app_is_platform_admin(), verifies email again, and creates/updates app_users.
-- Existing create_organization() calls app_ensure_platform_user() before creating the first tenant.
-- Generic access invitations continue to reject admin_ifarm in 0019_access_invitations.sql.
